import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { coordinatesFromDegrees, type Coordinates } from '@carwash/contracts/common';
import type { AddressV1 } from '@carwash/contracts/customer-v1';
import { useCustomerProduction } from '../../../data/CustomerProductionProvider';
import { useProductionBooking } from '../../../data/ProductionBookingProvider';
import { normalizeContact } from '../../../data/productionBooking';
import { formatMoney, PAYMENT_LABELS } from '../../../data/productionBookingContracts';
import { productionFailure } from '../../../data/productionCustomer';
import { currentInstant } from '../../../shared/clock';
import {
  bookingDays,
  damascusDate,
  damascusTime,
  damascusSlot,
} from '../../../data/productionDate';
import { requestBookingLocation } from '../../../data/productionDeviceLocation';
import { Icon } from '../../../shared/Icon';
import { Sheet } from '../../../shared/Sheet';
import { ReferenceArtSprite } from '../../../shared/art/ReferenceArt';
import { CustomerProfileSheet } from '../../../widgets/customer-access/CustomerProfileSheet';
import { JourneyNotice } from '../../../widgets/customer-access/JourneyNotice';
import { ProductionNotice } from '../../../widgets/customer-access/ProductionNotice';
import { VehicleEditorSheet } from '../../../widgets/vehicle-editor/VehicleEditorSheet';
import { sizeName, sizeArt } from '../../../widgets/vehicle-editor/vehicleEditorModel';
import { VehicleStage, VehicleTypeGrid } from '../vehicle/components/VehicleChoice';
import { SavedVehicleChips, VehicleDetailsRow } from '../vehicle/components/VehicleDetails';
import { LocationCard } from '../location/components/LocationCard';
import { CareContext, ExtrasRow } from '../care/components/CarePackageList';
import { BookingProgress } from '../BookingProgress';
import { bookingFlow } from '../bookingFlow';
import { ProductionFooter, QuoteBill } from './ProductionFooter';
import { WalletArt } from '../payment/PaymentStep';
import type { VehicleEditorValues } from '../../../state/savedVehicles';
import '../care/care.css';
import '../contact/contact.css';
import '../location/location.css';
import '../schedule/schedule.css';
import '../payment/payment.css';
import '../review/review.css';

const HEADINGS = [
  ['01 / سيارتك أولًا', 'أي سيارة ندلّل اليوم؟', 'اختر الحجم. تفاصيلها نضيفها مرة واحدة.', 'car'],
  ['02 / عناية على ذوقك', 'كيف تحبّ لمعتها؟', 'باقات واضحة. اختر ما تحتاجه فقط.', 'spark'],
  ['03 / أنت تختار المكان', 'أين نأتي لسيارتك؟', 'في البيت أو العمل. اللمعة تصلك.', 'pin'],
  ['04 / وقتك له الأولوية', 'متى يناسبك نجي؟', 'اختر وقت الوصول من المواعيد المتاحة.', 'calendar'],
  ['05 / نتعرّف عليك', 'بأي اسم نستقبلك؟', 'بيانات بسيطة للتواصل معك يوم الغسلة.', 'user'],
  ['06 / الدفع على راحتك', 'كيف تحبّ تدفع؟', 'ثلاث طرق واضحة. والاختيار دائمًا لك.', 'wallet'],
  ['07 / كل شيء واضح', 'غسلتك جاهزة للتأكيد.', 'راجع التفاصيل. وكل اختيار يمكنك تعديله.', 'check'],
] as const;

function Heading({ step }: { readonly step: number }) {
  const heading = HEADINGS[step]!;
  return (
    <>
      <BookingProgress step={step} />
      <div className="page-heading focused-heading">
        <div className="grow">
          <div className="eyebrow">{heading[0]}</div>
          <h1 tabIndex={-1}>{heading[1]}</h1>
          <p>{heading[2]}</p>
        </div>
        <span className="chapter-icon">
          <Icon name={heading[3]} />
        </span>
      </div>
    </>
  );
}
function useBlocked() {
  const { snapshot } = useProductionBooking()!;
  return (
    snapshot.busy ||
    snapshot.loading ||
    snapshot.pending !== null ||
    snapshot.unknownCreateKey !== null
  );
}
function Footer({
  step,
  ready = true,
  onNext,
}: {
  readonly step: number;
  readonly ready?: boolean;
  readonly onNext: () => void;
}) {
  const { snapshot } = useProductionBooking()!;
  const blocked = useBlocked();
  return (
    <ProductionFooter
      quote={snapshot.quote}
      catalog={snapshot.catalog}
      subscription={Boolean(snapshot.draft.subscription)}
      label={
        snapshot.busy ? 'جارٍ التحقق…' : step === 6 ? 'تأكيد الحجز' : bookingFlow[step]!.nextLabel
      }
      disabled={blocked || !ready}
      onNext={onNext}
    />
  );
}

function VehicleScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const customer = useCustomerProduction()!;
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(snapshot.draft.vehicle);
  const [save, setSave] = useState(false);
  const [editor, setEditor] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const blocked = useBlocked() || customer.snapshot.busy || customer.snapshot.pending !== null;
  const options = (['sedan', 'suv', 'large', 'pickup'] as const).map((type) => ({
    id: type,
    name: sizeName(type),
    art: sizeArt(type),
    selected: type === vehicle.type,
    priceLabel: 'السعر حسب العناية',
  }));
  const chooseSaved = (vehicleId: string) => {
    if (blocked) return;
    const saved = customer.snapshot.vehicles.find((item) => item.vehicleId === vehicleId);
    if (!saved) return;
    setVehicle({
      source: 'saved',
      vehicleId,
      revision: saved.revision,
      type: saved.type,
      model: saved.nickname ?? saved.model,
      color: saved.color,
      plate: saved.plate?.text ?? '',
    });
    setSave(false);
    setEditor(false);
  };
  const next = async () => {
    if (blocked) return;
    setProblem(null);
    if (save && vehicle.source === 'inline') {
      const result = await customer.client.saveVehicle(
        null,
        {
          type: vehicle.type,
          carName: vehicle.model ?? '',
          color: vehicle.color ?? '',
          plate: vehicle.plate,
          saveVehicle: true,
        },
        null,
      );
      if (!result.ok) {
        setProblem(productionFailure(result));
        return;
      }
      if ('vehicleId' in result.value && (await client.selectSavedVehicle(result.value)))
        navigate('/book/1');
      return;
    }
    if (await client.selectVehicle(vehicle)) navigate('/book/1');
  };
  const edit = (values: VehicleEditorValues) => {
    setVehicle({
      source: 'inline',
      type: values.type,
      model: values.carName.trim() || null,
      color: values.color.trim() || null,
      plate: values.plate,
    });
    setSave(values.saveVehicle);
    setEditor(false);
    return null;
  };
  return (
    <>
      <SavedVehicleChips
        choices={customer.snapshot.vehicles.map((item) => ({
          id: item.vehicleId,
          name: item.nickname ?? item.model ?? sizeName(item.type),
          selected: vehicle.source === 'saved' && item.vehicleId === vehicle.vehicleId,
        }))}
        onChoose={chooseSaved}
        onOther={() => setEditor(true)}
      />
      <VehicleStage
        art={sizeArt(vehicle.type)}
        name={vehicle.model ?? sizeName(vehicle.type)}
        plate={vehicle.plate}
        stageRef={stage}
      />
      <fieldset disabled={blocked} className="production-fields">
        <VehicleTypeGrid
          options={options}
          onSelect={(type) => setVehicle({ ...vehicle, source: 'inline', type })}
        />
        <label className="field plate-field">
          <span className="field-label">
            لوحة السيارة<small>اختيارية</small>
          </span>
          <span className="input-icon-wrap">
            <Icon name="car" />
            <input
              className="input plate-input"
              id="plate"
              maxLength={12}
              dir="auto"
              autoComplete="off"
              value={vehicle.plate}
              placeholder="مثال: 1234 أ ب ج"
              onChange={(event) =>
                setVehicle({ ...vehicle, source: 'inline', plate: event.target.value })
              }
            />
          </span>
          <span className="input-note">تساعد الفني على تمييز سيارتك.</span>
        </label>
        <VehicleDetailsRow
          summary={[vehicle.model, vehicle.color].filter(Boolean).join(' · ') || null}
          onOpen={() => setEditor(true)}
        />
        <label className="checkbox-row save-car-check">
          <input
            type="checkbox"
            checked={save}
            disabled={vehicle.source === 'saved'}
            onChange={(event) => setSave(event.target.checked)}
          />
          احفظ السيارة للحجز القادم.
        </label>
      </fieldset>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <ProductionNotice
        operation="vehicle-save"
        onConfirmed={(record) => {
          if ('vehicleId' in record)
            void client.selectSavedVehicle(record).then((ready) => {
              if (ready) navigate('/book/1');
            });
        }}
      />
      <VehicleEditorSheet
        open={editor}
        formKey="production-vehicle"
        context="booking"
        production
        initialValues={{
          type: vehicle.type,
          carName: vehicle.model ?? '',
          color: vehicle.color ?? '',
          plate: vehicle.plate,
          saveVehicle: save,
        }}
        choices={[]}
        onChoose={chooseSaved}
        onStartNew={() =>
          setVehicle({ source: 'inline', type: 'sedan', model: null, color: null, plate: '' })
        }
        onSubmit={edit}
        onClose={() => setEditor(false)}
        disabled={blocked}
      />
      <Footer step={0} ready={!blocked} onNext={() => void next()} />
    </>
  );
}

function CareScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const blocked = useBlocked();
  const [extrasOpen, setExtrasOpen] = useState(false);
  const vehicleType = snapshot.draft.vehicle.type;
  const definitions = (snapshot.catalog?.items ?? [])
    .filter((item) => item.status === 'PUBLISHED' && item.vehicleTypes.includes(vehicleType))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const packages = definitions.filter((item) => item.kind === 'PACKAGE');
  const extras = definitions.filter((item) => item.kind === 'EXTRA');
  const toggle = (id: string, checked: boolean) => {
    if (!snapshot.draft.packageId || blocked) return;
    void client.selectCare(
      snapshot.draft.packageId,
      checked
        ? [...snapshot.draft.extras, id]
        : snapshot.draft.extras.filter((item) => item !== id),
    );
  };
  return (
    <>
      <CareContext
        carLabel={snapshot.draft.vehicle.model ?? sizeName(vehicleType)}
        onChangeVehicle={() => navigate('/book/0')}
      />
      {snapshot.catalogStatus !== 'available' ? (
        <div className="info-note">
          <Icon name="info" />
          <span>تعذّر تحميل الباقات المنشورة.</span>
          <button className="text-btn" type="button" onClick={() => void client.loadCatalog()}>
            إعادة المحاولة
          </button>
        </div>
      ) : null}
      <div className="service-list signature-services" role="radiogroup" aria-label="باقة الغسيل">
        {packages.map((item) => {
          const selected = item.definitionId === snapshot.draft.packageId;
          const line = selected
            ? snapshot.quote?.lines.find((line) => line.definitionId === item.definitionId)
            : null;
          return (
            <label
              className={selected ? 'service-option selected' : 'service-option'}
              key={item.definitionId}
              data-care-package={item.definitionId}
            >
              <input
                className="choice"
                type="radio"
                name="service"
                checked={selected}
                disabled={blocked}
                onChange={() => void client.selectCare(item.definitionId)}
              />
              <div className="service-line">
                <span className="service-emblem emblem-essential">
                  <Icon name="spark" />
                </span>
                <span className="grow">
                  <span className="service-kicker">{item.code}</span>
                  <h3>{item.name.ar}</h3>
                  <p>
                    <Icon name="clock" /> {item.durationMinutes} دقيقة للعناية
                  </p>
                </span>
                <span className="service-side">
                  <span className="radio-circle">
                    {selected ? <Icon name="check" small /> : null}
                  </span>
                  <strong className="service-amount">
                    {line ? formatMoney(line.amount) : 'اختر لعرض السعر'}
                  </strong>
                </span>
              </div>
              <div className="service-features">
                <span>
                  <Icon name="check" />
                  {item.description.ar}
                </span>
              </div>
            </label>
          );
        })}
      </div>
      {!packages.length && snapshot.catalogStatus === 'available' ? (
        <p className="info-note">لا توجد باقات منشورة لهذا الحجم حاليًا.</p>
      ) : null}
      <ExtrasRow
        summary={
          snapshot.draft.extras.length
            ? `${snapshot.draft.extras.length} إضافات مختارة`
            : 'اختر ما تحتاجه فقط'
        }
        amount={snapshot.draft.extras.length ? 'ضمن عرض السعر' : 'اختيارية'}
        onOpen={() => setExtrasOpen(true)}
      />
      <Sheet open={extrasOpen} title="لمسات إضافية، على ذوقك." onClose={() => setExtrasOpen(false)}>
        <p className="sheet-intro">لا إضافات محددة مسبقًا. يمكنك المتابعة دون أي إضافة.</p>
        <div className="stack">
          {extras.map((item) => {
            const checked = snapshot.draft.extras.includes(item.definitionId);
            const line = snapshot.quote?.lines.find(
              (line) => line.definitionId === item.definitionId,
            );
            return (
              <label
                className={`addon-option ${checked ? 'selected' : ''}`}
                key={item.definitionId}
              >
                <input
                  className="choice"
                  type="checkbox"
                  checked={checked}
                  disabled={blocked || !snapshot.draft.packageId}
                  onChange={(event) => toggle(item.definitionId, event.target.checked)}
                />
                <span className="soft-icon">
                  <Icon name="plus" />
                </span>
                <span className="grow">
                  <strong>{item.name.ar}</strong>
                  <br />
                  <small>{item.description.ar}</small>
                </span>
                <span className="addon-price">
                  {line ? formatMoney(line.amount) : 'السعر بعد الاختيار'}
                </span>
                <span className="checkbox-ui">
                  <Icon name="check" />
                </span>
              </label>
            );
          })}
        </div>
        {!extras.length ? (
          <p className="input-note">لا توجد إضافات منشورة لهذا الحجم حاليًا.</p>
        ) : null}
        {snapshot.quote ? (
          <div className="bill-line total gap-top">
            <span>الإجمالي مع اختياراتك</span>
            <strong>{formatMoney(snapshot.quote.total)}</strong>
          </div>
        ) : null}
        <JourneyNotice />
        <button
          className="btn full gap-top"
          type="button"
          disabled={blocked}
          onClick={() => setExtrasOpen(false)}
        >
          حفظ الاختيارات <Icon name="check" small />
        </button>
      </Sheet>
      {snapshot.draft.packageId && !snapshot.quote ? (
        <button
          className="text-btn"
          type="button"
          disabled={blocked}
          onClick={() => void client.quote()}
        >
          تحديث عرض السعر
        </button>
      ) : null}
      <Footer step={1} ready={Boolean(snapshot.quote)} onNext={() => navigate('/book/2')} />
    </>
  );
}

function CoordinateAddressSheet({
  open,
  address,
  onClose,
  onSaved,
}: {
  readonly open: boolean;
  readonly address: AddressV1 | null;
  readonly onClose: () => void;
  readonly onSaved: (address: AddressV1) => void;
}) {
  const customer = useCustomerProduction()!;
  const [description, setDescription] = useState(address?.location.description ?? '');
  const [label, setLabel] = useState(address?.label ?? 'المنزل');
  const [note, setNote] = useState(address?.details ?? '');
  const [latitude, setLatitude] = useState(
    address?.location.mode === 'coordinates' ? address.location.point.latitude : '',
  );
  const [longitude, setLongitude] = useState(
    address?.location.mode === 'coordinates' ? address.location.point.longitude : '',
  );
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const blocked = customer.snapshot.busy || customer.snapshot.pending !== null || locating;
  const locate = () => {
    setLocating(true);
    setProblem(null);
    void requestBookingLocation()
      .then(
        (point) => {
          setLatitude(point.latitude);
          setLongitude(point.longitude);
        },
        () => setProblem('لم يُحدّد موقعك. يمكنك المحاولة مجددًا أو إدخال الإحداثيات.'),
      )
      .finally(() => setLocating(false));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    let point: Coordinates;
    try {
      if (!latitude.trim() || !longitude.trim()) throw new Error('point');
      point = coordinatesFromDegrees(Number(latitude), Number(longitude));
    } catch {
      setProblem('أدخل إحداثيات صحيحة أو استخدم موقعي الحالي.');
      return;
    }
    setProblem(null);
    void customer.client
      .saveAddress(
        address?.addressId ?? null,
        {
          address: description,
          addressLabel: label,
          locationNote: note,
          saveAddress: true,
          place: null,
        },
        address?.revision ?? null,
        point,
      )
      .then((result) => {
        if (!result.ok) {
          setProblem(productionFailure(result));
          return;
        }
        if ('addressId' in result.value) onSaved(result.value);
      });
  };
  return (
    <Sheet open={open} title="مكان سيارتك، بكل بساطة." onClose={onClose}>
      <p className="sheet-intro">اكتب عنوان السيارة وحدّد موقعها للتحقق من وصول الخدمة.</p>
      <button className="btn secondary full" type="button" disabled={blocked} onClick={locate}>
        <Icon name="pin" small />
        {locating ? 'جارٍ تحديد الموقع…' : 'موقعي الحالي'}
      </button>
      <p className="input-note">
        نرسل الإحداثيات عند حفظ العنوان للتحقق من نطاق الخدمة. اختر موقع السيارة إذا كان مختلفًا عن
        موقعك.
      </p>
      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-label">العنوان بالتفصيل</span>
          <input
            className="input"
            name="address"
            maxLength={160}
            value={description}
            disabled={blocked}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="الحي، الشارع، المبنى ومكان السيارة"
          />
        </label>
        <div className="two-fields">
          <label className="field">
            <span className="field-label">اسم العنوان</span>
            <input
              className="input"
              maxLength={30}
              value={label}
              disabled={blocked}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">ملاحظة الوصول</span>
            <input
              className="input"
              maxLength={160}
              value={note}
              disabled={blocked}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>
        <details className="optional-details" open={!latitude || !longitude}>
          <summary>إحداثيات موقع السيارة</summary>
          <div className="two-fields">
            <label className="field">
              <span className="field-label">خط العرض</span>
              <input
                className="input ltr"
                name="latitude"
                inputMode="decimal"
                value={latitude}
                disabled={blocked}
                onChange={(event) => setLatitude(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">خط الطول</span>
              <input
                className="input ltr"
                name="longitude"
                inputMode="decimal"
                value={longitude}
                disabled={blocked}
                onChange={(event) => setLongitude(event.target.value)}
              />
            </label>
          </div>
        </details>
        {problem ? (
          <p className="error" role="alert">
            {problem}
          </p>
        ) : null}
        <ProductionNotice
          operation="address-save"
          onConfirmed={(record) => {
            if ('addressId' in record) onSaved(record);
          }}
        />
        <button className="btn full gap-top" type="submit" disabled={blocked}>
          اعتماد هذا المكان <Icon name="check" small />
        </button>
      </form>
    </Sheet>
  );
}

function LocationScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const customer = useCustomerProduction()!;
  const navigate = useNavigate();
  const [editor, setEditor] = useState<{
    readonly address: AddressV1 | null;
    readonly round: number;
  } | null>(null);
  const address = snapshot.draft.address;
  const blocked = useBlocked();
  const open = (value: AddressV1 | null) =>
    setEditor({ address: value, round: currentInstant().getTime() });
  const choose = (value: AddressV1) => {
    if (blocked) return;
    if (value.location.mode === 'manual') open(value);
    else void client.selectAddress(value);
  };
  const next = () => {
    if (snapshot.serviceability?.decision === 'SERVICEABLE' && snapshot.quote?.zoneId && address)
      navigate('/book/3');
  };
  return (
    <>
      {customer.snapshot.addresses.length ? (
        <div className="chips saved-address-chips" role="group" aria-label="عناوين محفوظة">
          {customer.snapshot.addresses.map((item) => (
            <button
              className={`chip ${item.addressId === address?.addressId ? 'selected' : ''}`}
              type="button"
              key={item.addressId}
              aria-pressed={item.addressId === address?.addressId}
              disabled={blocked}
              onClick={() => choose(item)}
            >
              <Icon name="pin" small />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <LocationCard
        label={address?.label ?? 'موقع سيارتك'}
        title={address?.location.description ?? 'أضف عنوانًا لغسلتك'}
        preview={address?.details ?? 'نحتاج العنوان وموقع السيارة للتحقق من التغطية'}
        hasAddress={Boolean(address)}
        onOpen={() => open(address)}
      />
      <div className="row between gap-top">
        <button className="text-btn" type="button" disabled={blocked} onClick={() => open(null)}>
          إضافة عنوان آخر <Icon name="plus" small />
        </button>
        {address ? (
          <button
            className="text-btn"
            type="button"
            disabled={blocked}
            onClick={() => void client.selectAddress(address)}
          >
            إعادة التحقق من التغطية والسعر
          </button>
        ) : null}
      </div>
      <div className="info-note location-tip">
        <Icon name="info" />
        <span>
          لتسهيل الوصول، أضف الشارع ومكان الوقوف. يمكن إبقاء عنوان نصي في حسابك؛ اختيار الموعد يتطلب
          تحقق تغطية الموقع.
        </span>
      </div>
      {snapshot.serviceability?.decision === 'SERVICEABLE' ? (
        <div className="selection-summary has-value" role="status">
          <Icon name="check" />
          الخدمة متاحة لهذا الموقع.
        </div>
      ) : null}
      {editor ? (
        <CoordinateAddressSheet
          key={editor.round}
          open
          address={editor.address}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            setEditor(null);
            void client.selectAddress(saved);
          }}
        />
      ) : null}
      <Footer
        step={2}
        ready={Boolean(
          snapshot.serviceability?.decision === 'SERVICEABLE' && snapshot.quote?.zoneId,
        )}
        onNext={next}
      />
    </>
  );
}

function ScheduleScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const [day, setDay] = useState(
    snapshot.availability?.date ?? damascusDate(currentInstant().getTime()),
  );
  const [allTimes, setAllTimes] = useState(false);
  const blocked = useBlocked();
  const quoteId = snapshot.quote?.quoteId;
  useEffect(() => {
    if (quoteId) void client.loadAvailability(day);
  }, [client, day, quoteId]);
  useEffect(() => {
    if (quoteId) void client.loadEarliest();
  }, [client, quoteId]);
  const days = bookingDays(currentInstant().getTime());
  if (!days.some((item) => item.date === day))
    days.push(bookingDays(Date.parse(`${day}T12:00:00Z`))[0]!);
  const slots = (snapshot.availability?.slots ?? []).filter(
    (slot) => Date.parse(slot.startsAt) > currentInstant().getTime(),
  );
  const visible = allTimes ? slots : slots.slice(0, 6);
  const choose = (startsAt: string) => {
    if (!blocked) void client.chooseSlot(startsAt);
  };
  return (
    <>
      <div className="choice-context">
        <Icon name="pin" small />
        <span className="grow">
          {snapshot.draft.address?.location.description ?? snapshot.draft.address?.label}
        </span>
        <button className="text-btn" type="button" onClick={() => navigate('/book/2')}>
          تغيير
        </button>
      </div>
      <button
        className="earliest signature-earliest"
        type="button"
        disabled={
          blocked ||
          snapshot.earliestStatus !== 'available' ||
          !snapshot.earliestAvailability?.earliest
        }
        onClick={() => {
          void client.chooseEarliest().then((hold) => {
            if (hold) {
              setDay(damascusDate(Date.parse(hold.startsAt)));
              setAllTimes(false);
            }
          });
        }}
      >
        <span className="chapter-icon">
          <Icon name="bolt" />
        </span>
        <span className="grow">
          <strong>أقرب موعد متاح</strong>
          <p>
            {snapshot.earliestStatus === 'loading'
              ? 'جارٍ البحث عن أقرب موعد…'
              : snapshot.earliestAvailability?.earliest
                ? damascusSlot(snapshot.earliestAvailability.earliest.startsAt)
                : snapshot.earliestStatus === 'unavailable'
                  ? 'تعذّر تحميل أقرب موعد'
                  : 'لا يوجد موعد متاح'}
          </p>
        </span>
        <Icon name="left" small />
      </button>
      {snapshot.earliestStatus === 'unavailable' ? (
        <button
          className="text-btn"
          type="button"
          disabled={blocked}
          onClick={() => void client.loadEarliest()}
        >
          إعادة البحث عن أقرب موعد
        </button>
      ) : null}
      <div className="mini-title">
        أو اختر يومًا يناسبك <small>توقيت دمشق</small>
      </div>
      <div className="dates" role="group" aria-label="اختر اليوم">
        {days.map(({ date, weekday, month }) => (
          <button
            className={date === day ? 'date selected' : 'date'}
            type="button"
            key={date}
            aria-pressed={date === day}
            disabled={snapshot.busy || snapshot.pending !== null}
            onClick={() => {
              setDay(date);
              setAllTimes(false);
            }}
          >
            <small>{weekday}</small>
            <strong>{date.slice(8)}</strong>
            <span>{month}</span>
          </button>
        ))}
      </div>
      <div className="mini-title">
        وقت الوصول <small>{snapshot.quote?.durationMinutes} دقيقة للعناية</small>
      </div>
      <div className="times" role="group" aria-label="الأوقات المتاحة">
        {visible.map((slot) => (
          <button
            className={snapshot.hold?.startsAt === slot.startsAt ? 'time selected' : 'time'}
            type="button"
            key={slot.startsAt}
            disabled={blocked}
            aria-pressed={snapshot.hold?.startsAt === slot.startsAt}
            onClick={() => choose(slot.startsAt)}
          >
            {damascusTime(slot.startsAt)}
            {snapshot.hold?.startsAt === slot.startsAt ? <Icon name="check" small /> : null}
          </button>
        ))}
      </div>
      {snapshot.loading ? (
        <p className="input-note" role="status">
          جارٍ تحميل المواعيد…
        </p>
      ) : !slots.length ? (
        <p className="info-note">لا يوجد وقت متاح لهذا اليوم. اختر يومًا آخر.</p>
      ) : null}
      {slots.length > 6 ? (
        <div className="center">
          <button className="text-btn" type="button" onClick={() => setAllTimes(!allTimes)}>
            {allTimes ? 'عرض أوقات أقل' : 'عرض كل الأوقات'}{' '}
            <Icon name={allTimes ? 'up' : 'down'} small />
          </button>
        </div>
      ) : null}
      <div className={`selection-summary ${snapshot.hold ? 'has-value' : ''}`} aria-live="polite">
        <Icon name={snapshot.hold ? 'check' : 'clock'} />
        <span>
          {snapshot.hold
            ? `${damascusSlot(snapshot.hold.startsAt)} · محفوظ مؤقتًا حتى ${damascusTime(snapshot.hold.expiresAt)}`
            : 'اختر الوقت، ثم نكمل بيانات التواصل.'}
        </span>
      </div>
      <Footer
        step={3}
        ready={Boolean(
          snapshot.hold &&
          snapshot.hold.state === 'HELD' &&
          Date.parse(snapshot.hold.expiresAt) > currentInstant().getTime(),
        )}
        onNext={() => navigate('/book/4')}
      />
    </>
  );
}

function ContactScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const customer = useCustomerProduction()!;
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const contact = snapshot.draft.contact;
  const blocked = useBlocked();
  const edit = (field: keyof typeof contact, value: string) => {
    setProblem(null);
    client.setContact({ ...contact, [field]: value });
  };
  useEffect(() => {
    if (!contact.name && !contact.phone && customer.snapshot.profile)
      client.setContact({
        name: customer.snapshot.profile.contact.displayName ?? '',
        phone: customer.snapshot.profile.contact.phone ?? '',
        notes: contact.notes,
      });
    // Seed once on entry; later edits remain the customer's own draft.
  }, []);
  const next = () => {
    if (!normalizeContact(contact)) {
      setProblem('أدخل اسمًا من حرفين على الأقل ورقم تواصل صحيحًا.');
      document.getElementById(!contact.name.trim() ? 'name' : 'phone')?.focus();
      return;
    }
    navigate('/book/5');
  };
  return (
    <>
      <label className="field">
        <span className="field-label">
          الاسم<small>مطلوب</small>
        </span>
        <input
          className="input"
          id="name"
          autoComplete="name"
          maxLength={80}
          value={contact.name}
          disabled={blocked}
          onChange={(event) => edit('name', event.target.value)}
          placeholder="مثال: سامر"
        />
      </label>
      <label className="field">
        <span className="field-label">
          رقم التواصل<small>مطلوب</small>
        </span>
        <input
          className="input ltr"
          id="phone"
          type="tel"
          autoComplete="tel"
          maxLength={32}
          value={contact.phone}
          disabled={blocked}
          onChange={(event) => edit('phone', event.target.value)}
          placeholder="09XX XXX XXX"
        />
      </label>
      <p className="input-note">نستخدم هذا الرقم للتواصل بشأن الحجز. كتابته لا تثبت ملكيته.</p>
      <details className="optional-details">
        <summary>
          ملاحظة للفني <span className="tiny muted">اختياري</span>
        </summary>
        <label className="sr-only" htmlFor="note">
          ملاحظة للفني
        </label>
        <textarea
          className="input"
          id="note"
          maxLength={500}
          rows={2}
          value={contact.notes}
          disabled={blocked}
          onChange={(event) => edit('notes', event.target.value)}
          placeholder="مثال: السيارة بجانب المدخل الخلفي"
        />
      </details>
      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="info-note">
        <Icon name="lock" />
        <span>لا نطلب أرقام بطاقات أو كلمة مرور المحفظة في بيانات الحجز.</span>
      </div>
      <Footer step={4} onNext={next} />
    </>
  );
}

export const PAY_OPTIONS = [
  { method: 'CASH_ON_COMPLETION', icon: 'banknote', tone: 'cash', hint: 'بعد إتمام الغسيل' },
  { method: 'SHAM_CASH', icon: 'wallet', tone: 'sham', hint: 'تأكيد التحويل من حساب التاجر' },
  {
    method: 'SYRIATEL_CASH',
    icon: 'signal-pay',
    tone: 'syriatel',
    hint: 'تأكيد التحويل من حساب التاجر',
  },
] as const;
function PaymentScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const blocked = useBlocked();
  useEffect(() => {
    if (snapshot.principal?.kind === 'account') void client.loadSubscriptions();
  }, [client, snapshot.principal]);
  return (
    <>
      <section className="pay-hero">
        <div>
          <small>{snapshot.draft.subscription ? 'قيمة العناية المغطاة' : 'إجمالي غسلتك'}</small>
          <strong>
            {snapshot.quote ? formatMoney(snapshot.quote.total) : 'يحتاج تحديث السعر'}
          </strong>
          {snapshot.draft.subscription ? (
            <p>
              تُحجز غسلة من اشتراكك عند تأكيد الحجز.
              <br />
              لا تنشأ مطالبة دفع لهذا الحجز.
            </p>
          ) : (
            <p>
              السعر نفسه في كل الخيارات.
              <br />
              حالة الدفع يثبتها سجل التحصيل.
            </p>
          )}
        </div>
        <WalletArt />
      </section>
      <fieldset className="pay-choices" disabled={blocked}>
        <legend className="sr-only">اختر طريقة الدفع</legend>
        {PAY_OPTIONS.map((option) => (
          <label
            className={`pay-option ${!snapshot.draft.subscription && snapshot.draft.paymentMethod === option.method ? 'selected' : ''}`}
            key={option.method}
          >
            <input
              type="radio"
              name="paymentMethod"
              checked={
                !snapshot.draft.subscription && snapshot.draft.paymentMethod === option.method
              }
              onChange={() => client.setPaymentMethod(option.method)}
            />
            <div className="pay-option-row">
              <span className={`pay-logo ${option.tone}`}>
                <Icon name={option.icon} />
              </span>
              <div className="pay-option-text">
                <strong>{PAYMENT_LABELS[option.method]}</strong>
                <p>{option.hint}</p>
              </div>
              <span className="pay-tick">
                <Icon name="check" />
              </span>
            </div>
            {!snapshot.draft.subscription && snapshot.draft.paymentMethod === option.method ? (
              <div className="pay-selected-note pay-reveal">
                <Icon name={option.method === 'CASH_ON_COMPLETION' ? 'check' : 'qr-pay'} />
                <span>
                  {option.method === 'CASH_ON_COMPLETION'
                    ? 'لا دفع مسبق. تؤكد الحجز وتكمل يومك.'
                    : 'يُراجع رقم العملية بعد الحجز. لن نعرض مستفيدًا أو رمز دفع غير موثّق.'}
                </span>
              </div>
            ) : null}
          </label>
        ))}
      </fieldset>
      {snapshot.principal?.kind === 'account' ? (
        <section className="pay-how">
          <h3>استخدام اشتراكي</h3>
          <p className="pay-proof-note">
            نطلب تحققًا من تغطية الباقة والسيارة والموعد قبل استخدام الغسلة. الإضافات لا يشملها هذا
            المسار.
          </p>
          {snapshot.subscriptionsStatus === 'loading' ? (
            <p role="status">جارٍ قراءة اشتراكاتك…</p>
          ) : snapshot.subscriptionsStatus === 'unavailable' ? (
            <button
              type="button"
              className="btn secondary full"
              onClick={() => void client.loadSubscriptions()}
            >
              إعادة قراءة الاشتراكات
            </button>
          ) : snapshot.subscriptions.length === 0 ? (
            <p className="input-note">لا توجد اشتراكات محفوظة لهذا الحساب.</p>
          ) : (
            <fieldset className="pay-choices" disabled={blocked}>
              <legend className="sr-only">اختيار اشتراك للحجز</legend>
              {snapshot.subscriptions.map((subscription) => (
                <label
                  key={subscription.subscriptionId}
                  className={`pay-option ${snapshot.draft.subscription?.subscriptionId === subscription.subscriptionId ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="bookingFunding"
                    checked={
                      snapshot.draft.subscription?.subscriptionId === subscription.subscriptionId
                    }
                    onChange={() => void client.selectSubscription(subscription.subscriptionId)}
                  />
                  <div className="pay-option-row">
                    <span className="pay-logo cash">
                      <Icon name="spark" />
                    </span>
                    <div className="pay-option-text">
                      <strong>اشتراك #{subscription.subscriptionId.slice(0, 8)}</strong>
                      <p>
                        {subscription.units.available} غسلات متاحة · حتى{' '}
                        {damascusSlot(subscription.expiresAt)}
                      </p>
                    </div>
                    <span className="pay-tick">
                      <Icon name="check" />
                    </span>
                  </div>
                  {snapshot.draft.subscription?.subscriptionId === subscription.subscriptionId ? (
                    <p className="pay-selected-note">
                      تحققت الجهة المالكة من التغطية. تُعاد مراجعة الاستحقاق عند التأكيد.
                    </p>
                  ) : null}
                </label>
              ))}
            </fieldset>
          )}
          {snapshot.subscriptionsCursor ? (
            <button
              type="button"
              className="btn secondary full"
              disabled={snapshot.subscriptionsStatus === 'loading'}
              onClick={() => void client.loadSubscriptions(true)}
            >
              عرض المزيد من الاشتراكات
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="pay-safe">
        <Icon name="lock" />
        <span>
          لا نطلب كلمة مرور المحفظة أو رمز التحقق.
          <br />
          إتمام التحويل يكون داخل تطبيق المحفظة فقط.
        </span>
      </div>
      <details className="pay-how">
        <summary>
          <Icon name="info" />
          عن المبلغ والرسوم <Icon name="down" />
        </summary>
        <p className="pay-proof-note">
          الإجمالي من عرض السعر الحالي. رسوم مزوّد المحفظة، إن وجدت، تُراجع داخل تطبيقه. اختيار
          الوسيلة أو إرسال رقم العملية لا يعني تأكيد استلام المال.
        </p>
      </details>
      <Footer
        step={5}
        ready={Boolean(snapshot.draft.paymentMethod || snapshot.draft.subscription)}
        onNext={() => navigate('/book/6')}
      />
    </>
  );
}

function ReviewScreen() {
  const { client, snapshot } = useProductionBooking()!;
  const navigate = useNavigate();
  const { draft, quote, hold } = snapshot;
  const rows = [
    {
      step: 0,
      icon: 'car' as const,
      title: draft.vehicle.model ?? sizeName(draft.vehicle.type),
      text: [sizeName(draft.vehicle.type), draft.vehicle.plate, draft.vehicle.color]
        .filter(Boolean)
        .join(' · '),
    },
    {
      step: 1,
      icon: 'spark' as const,
      title:
        snapshot.catalog?.items.find((item) => item.definitionId === draft.packageId)?.name.ar ??
        'العناية المختارة',
      text: `${quote?.durationMinutes ?? '—'} دقيقة للعناية`,
    },
    {
      step: 2,
      icon: 'pin' as const,
      title: draft.address?.label ?? 'العنوان',
      text: draft.address?.location.description ?? '',
    },
    {
      step: 3,
      icon: 'calendar' as const,
      title: hold ? damascusSlot(hold.startsAt) : 'الموعد',
      text: 'توقيت دمشق',
    },
    { step: 4, icon: 'user' as const, title: draft.contact.name, text: draft.contact.phone },
    {
      step: 5,
      icon: 'wallet' as const,
      title: draft.subscription
        ? 'غسلة من اشتراكي'
        : draft.paymentMethod
          ? PAYMENT_LABELS[draft.paymentMethod]
          : 'طريقة الدفع',
      text: draft.subscription
        ? 'التغطية تؤكدها الجهة المالكة عند الحجز'
        : draft.paymentMethod === 'CASH_ON_COMPLETION'
          ? 'كاش بعد إتمام الغسيل'
          : 'التحقق قبل بدء الخدمة',
    },
  ];
  return (
    <>
      <div className="receipt">
        {rows.map((row) => (
          <div className="receipt-line" key={row.step}>
            <Icon name={row.icon} />
            <div className="grow">
              <strong>{row.title}</strong>
              <p dir="auto">{row.text}</p>
            </div>
            <button
              className="edit"
              type="button"
              aria-label={`تعديل ${bookingFlow[row.step]!.label}`}
              onClick={() => navigate(`/book/${row.step}`)}
            >
              تعديل
            </button>
          </div>
        ))}
      </div>
      {quote ? <QuoteBill quote={quote} catalog={snapshot.catalog} /> : null}
      <div className="info-note">
        <Icon name="info" />
        <span>
          نتحقق من السعر والموعد عند التأكيد. ستظهر نتيجة الحجز الفعلية في حجوزاتي؛ اختيار الدفع لا
          يعني أن المال وصل.
        </span>
      </div>
      <Footer
        step={6}
        ready={client.prerequisites() === 6}
        onNext={() =>
          void client.confirm().then((booking) => {
            if (booking) navigate(`/order/${booking.bookingId}`, { replace: true });
          })
        }
      />
    </>
  );
}

/** The same seven approved decisions, fed exclusively by owner facts. */
export function ProductionJourney({ step }: { readonly step: number }) {
  const journey = useProductionBooking()!;
  const customer = useCustomerProduction()!;
  const [accessOpen, setAccessOpen] = useState(false);
  const [, tick] = useState(0);
  const { client, snapshot } = journey;
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const previous = document.title;
    document.title = `${bookingFlow[step]!.label} — WashGo Signature`;
    return () => {
      document.title = previous;
    };
  }, [step]);
  const authenticated =
    customer.snapshot.authStatus === 'authenticated' && snapshot.principal !== null;
  if (authenticated && snapshot.handoffBookingId)
    return <Navigate to={`/order/${snapshot.handoffBookingId}`} replace />;
  const allowed =
    step > 3
      ? Math.min(step, client.prerequisites())
      : step === 3
        ? Math.min(step, client.prerequisites())
        : step;
  if (authenticated && !snapshot.unknownCreateKey && !snapshot.pending && allowed !== step)
    return <Navigate to={`/book/${allowed}`} replace />;
  return (
    <div
      data-customer-route={`booking-${bookingFlow[step]!.id}`}
      data-booking-step={bookingFlow[step]!.id}
      data-runtime="production"
    >
      <ReferenceArtSprite />
      <Heading step={step} />
      {!authenticated || customer.snapshot.profileStatus !== 'available' ? (
        <>
          <p className="info-note">
            {customer.snapshot.loading
              ? 'جارٍ تحميل بياناتك…'
              : 'تابع بجلسة ضيف أو سجّل الدخول، ثم احفظ بيانات التواصل للمتابعة.'}
          </p>
          <button
            className="btn full"
            type="button"
            disabled={customer.snapshot.loading || customer.snapshot.busy}
            onClick={() => setAccessOpen(true)}
          >
            متابعة الحجز
          </button>
          <CustomerProfileSheet open={accessOpen} onClose={() => setAccessOpen(false)} />
        </>
      ) : snapshot.unknownCreateKey ? (
        <p className="info-note">نحتاج التحقق من نتيجة تأكيد الحجز السابق قبل إنشاء حجز آخر.</p>
      ) : step === 0 ? (
        <VehicleScreen
          key={
            snapshot.draft.vehicle.source === 'saved' ? snapshot.draft.vehicle.vehicleId : 'inline'
          }
        />
      ) : step === 1 ? (
        <CareScreen />
      ) : step === 2 ? (
        <LocationScreen />
      ) : step === 3 ? (
        <ScheduleScreen />
      ) : step === 4 ? (
        <ContactScreen />
      ) : step === 5 ? (
        <PaymentScreen />
      ) : (
        <ReviewScreen />
      )}
      <JourneyNotice />
    </div>
  );
}
