import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentInstant } from '../../shared/clock';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { ReferenceArtSprite } from '../../shared/art/ReferenceArt';
import { spawnTapWave } from '../../shared/tapWave';
import { useCustomerSession } from '../../state/CustomerSessionProvider';
import { pathForIntent } from '../../state/navigationPath';
import {
  blankEditorValues,
  bookSavedVehicle,
  deleteSavedVehicle,
  editorValuesForVehicle,
  saveGarageVehicle,
  type VehicleEditorValues,
} from '../../state/savedVehicles';
import { VehicleEditorSheet } from '../../widgets/vehicle-editor/VehicleEditorSheet';
import { sizeName } from '../../widgets/vehicle-editor/vehicleEditorModel';
import { GarageEmpty, GarageList } from './components/GarageList';
import { buildGarageViewModel } from './garageViewModel';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import { productionFailure } from '../../data/productionCustomer';
import { CustomerProfileSheet } from '../../widgets/customer-access/CustomerProfileSheet';
import { ProductionNotice } from '../../widgets/customer-access/ProductionNotice';
import './garage.css';
import { useProductionBooking } from '../../data/ProductionBookingProvider';

const DOCUMENT_TITLE = 'WashGo Signature — وقتك لك، واللمعة علينا';

/** `null` adds a new car; an id edits that saved car. */
type EditorTarget = {
  readonly vehicleId: string | null;
  readonly revision?: number;
  readonly principalKey?: string;
};

export function GarageRoute() {
  const { state, run } = useCustomerSession();
  const production = useCustomerProduction();
  const journey = useProductionBooking();
  const navigate = useNavigate();
  const view = useMemo(() => buildGarageViewModel(state), [state]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteRevision, setDeleteRevision] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const session = production?.snapshot.session;
  const principalKey =
    production?.snapshot.authStatus === 'authenticated' && session
      ? `${session.principalKind}:${session.subject}:${session.sessionId}:${session.authVersion}`
      : null;
  const editorVisible =
    editor !== null &&
    (!production || (principalKey !== null && editor.principalKey === principalKey));
  const openEditor = (vehicleId: string | null, revision?: number) =>
    setEditor({
      vehicleId,
      ...(revision === undefined ? {} : { revision }),
      ...(production ? { principalKey: principalKey ?? '' } : {}),
    });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = DOCUMENT_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const editing = state.vehicles.find((vehicle) => vehicle.id === editor?.vehicleId);
  const deletingVehicle = state.vehicles.find((vehicle) => vehicle.id === deleting);
  const ownerVehicle = production?.snapshot.vehicles.find(
    (vehicle) => vehicle.vehicleId === editor?.vehicleId,
  );
  const disabled = production
    ? production.snapshot.busy ||
      production.snapshot.loading ||
      production.snapshot.pending !== null ||
      production.snapshot.vehiclesStatus !== 'available'
    : false;

  const submitEditor = (values: VehicleEditorValues) => {
    if (production && !editorVisible) return 'تغيّرت الجلسة. افتح نافذة السيارة من جديد.';
    if (production)
      return production.client
        .saveVehicle(editor?.vehicleId ?? null, values, editor?.revision ?? null)
        .then((result) => {
          if (result.ok) setEditor(null);
          return productionFailure(result);
        });
    const { error } = run((current) =>
      saveGarageVehicle(current, editor?.vehicleId ?? null, values, sizeName(values.type)),
    );
    if (!error) setEditor(null);
    return error;
  };

  const book = (vehicleId: string) => {
    if (production && journey) {
      const vehicle = production.snapshot.vehicles.find((item) => item.vehicleId === vehicleId);
      if (vehicle)
        void journey.client.selectSavedVehicle(vehicle).then((ready) => {
          if (ready) navigate('/book/0');
        });
      return;
    }
    const { intent } = run((current) => bookSavedVehicle(current, vehicleId, currentInstant()));
    if (intent) void navigate(pathForIntent(intent));
  };

  const confirmDelete = () => {
    if (production) {
      if (!deleting || deleteRevision === null || disabled) return;
      void production.client.archiveVehicle(deleting, deleteRevision).then((result) => {
        setDeleteError(productionFailure(result));
        if (result.ok) setDeleting(null);
      });
      return;
    }
    if (deleting) run((current) => ({ state: deleteSavedVehicle(current, deleting) }));
    setDeleting(null);
  };

  const add = () => {
    if (
      production &&
      (production.snapshot.authStatus !== 'authenticated' ||
        production.snapshot.profileStatus !== 'available')
    )
      setAccessOpen(true);
    else openEditor(null);
  };

  return (
    <div data-customer-route="garage" data-customer-fixture="garage-default">
      <ReferenceArtSprite />
      <div className="page-heading">
        <div className="grow">
          <div className="eyebrow">أضفها مرة. واحجز براحتك.</div>
          <h1 tabIndex={-1}>سياراتي.</h1>
          <p>نوع السيارة ولوحتها وتفاصيلها، جاهزة للغسلة القادمة.</p>
        </div>
      </div>
      {view.empty ? (
        <GarageEmpty />
      ) : (
        <GarageList
          cards={view.cards}
          onBook={book}
          onEdit={(vehicleId) => {
            const revision = production?.snapshot.vehicles.find(
              (vehicle) => vehicle.vehicleId === vehicleId,
            )?.revision;
            openEditor(vehicleId, revision);
          }}
          onDelete={(vehicleId) => {
            setDeleting(vehicleId);
            setDeleteRevision(
              production?.snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId)
                ?.revision ?? null,
            );
            setDeleteError(null);
          }}
          bookingAvailable={
            !production ||
            Boolean(
              journey &&
              !journey.snapshot.busy &&
              !journey.snapshot.pending &&
              !journey.snapshot.unknownCreateKey,
            )
          }
          editingDisabled={disabled}
        />
      )}
      <button
        className={view.empty ? 'btn full gap-top' : 'btn outline full gap-top'}
        type="button"
        aria-haspopup="dialog"
        data-garage-action="add"
        onPointerDown={spawnTapWave}
        onClick={add}
        disabled={
          production
            ? production.snapshot.busy ||
              production.snapshot.loading ||
              production.snapshot.pending !== null
            : false
        }
      >
        <Icon name="plus" small />
        إضافة سيارة
      </button>
      <p className="save-note">
        <Icon name="lock" />{' '}
        {production
          ? 'الحفظ مرتبط بجلسة المستخدم في الخدمة. يمكنك بدء حجز جديد بهذه السيارة.'
          : 'الحفظ محلي، وليس حسابًا سحابيًا.'}
      </p>
      {production &&
      production.snapshot.authStatus === 'authenticated' &&
      production.snapshot.vehiclesStatus !== 'available' ? (
        <div className="info-note" role="alert">
          <div className="grow">
            <p>تعذّر تحميل السيارات من الخدمة. لا يمكن تأكيد القائمة أو تعديلها الآن.</p>
            <button
              className="btn secondary full gap-top"
              type="button"
              disabled={production.snapshot.loading || production.snapshot.busy}
              onClick={() => void production.client.load()}
            >
              إعادة تحميل السيارات
            </button>
          </div>
        </div>
      ) : null}
      <ProductionNotice />
      <VehicleEditorSheet
        open={editorVisible}
        formKey={editor?.vehicleId ?? 'new'}
        context="garage"
        initialValues={
          ownerVehicle
            ? {
                type: ownerVehicle.type,
                carName: ownerVehicle.nickname ?? '',
                plate: ownerVehicle.plate?.text ?? '',
                color: ownerVehicle.color ?? '',
                saveVehicle: true,
              }
            : editing
              ? editorValuesForVehicle(editing)
              : blankEditorValues
        }
        choices={[]}
        onChoose={() => undefined}
        onStartNew={() => undefined}
        onSubmit={submitEditor}
        onClose={() => setEditor(null)}
        production={production !== null}
        disabled={disabled}
        footer={<ProductionNotice operation="vehicle-save" onConfirmed={() => setEditor(null)} />}
      />
      <Sheet
        open={deletingVehicle !== undefined}
        title="حذف السيارة المحفوظة؟"
        onClose={() => setDeleting(null)}
      >
        <p className="sheet-intro">
          {`ستُحذف ${deletingVehicle?.name ?? ''} من سياراتك. تفاصيل الحجوزات السابقة تبقى كما كانت.`}
        </p>
        {deleteError ? (
          <p className="error" role="alert">
            {deleteError}
          </p>
        ) : null}
        <ProductionNotice operation="vehicle-archive" onConfirmed={() => setDeleting(null)} />
        <button
          className="btn danger full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={confirmDelete}
          disabled={disabled}
        >
          حذف السيارة
        </button>
        <button
          className="btn secondary full"
          type="button"
          onPointerDown={spawnTapWave}
          onClick={() => setDeleting(null)}
        >
          رجوع
        </button>
      </Sheet>
      <CustomerProfileSheet
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        onSaved={() => openEditor(null)}
      />
    </div>
  );
}
