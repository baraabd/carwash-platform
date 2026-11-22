import { useState, type FormEvent } from 'react';
import type { CustomerProfileV1 } from '@carwash/contracts/customer-v1';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import { productionFailure } from '../../data/productionCustomer';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';
import { ProductionNotice } from './ProductionNotice';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSaved?: () => void;
}

function ProfileFields({
  profile,
  onSaved,
}: {
  readonly profile: CustomerProfileV1 | null;
  readonly onSaved: () => void;
}) {
  const production = useCustomerProduction();
  const [name, setName] = useState(profile?.contact.displayName ?? '');
  const [phone, setPhone] = useState(profile?.contact.phone ?? '');
  const [revision] = useState(profile?.revision ?? null);
  const [locale] = useState(profile?.preferences.locale ?? 'ar');
  const [problem, setProblem] = useState<string | null>(null);
  if (!production) return null;
  const { client, snapshot } = production;
  const blocked = snapshot.busy || snapshot.loading || snapshot.pending !== null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setProblem(null);
    void client
      .saveProfile(
        { displayName: name.trim() || null, phone: phone.trim() || null, locale },
        revision,
      )
      .then((result) => {
        setProblem(productionFailure(result));
        if (result.ok) onSaved();
      });
  };
  return (
    <form id="profile-form" noValidate onSubmit={submit}>
      <label className="field">
        <span className="field-label">الاسم</span>
        <input
          className="input"
          name="profileName"
          maxLength={80}
          value={name}
          autoComplete="name"
          disabled={blocked}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">
          رقم الجوال <small>اختياري هنا</small>
        </span>
        <input
          className="input ltr"
          type="tel"
          name="profilePhone"
          maxLength={13}
          value={phone}
          autoComplete="tel"
          disabled={blocked}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>
      <p className="input-note">
        عند إضافة رقم، اكتبه بالصيغة الدولية +9639XXXXXXXX. حفظ الرقم لا يثبت ملكيته ولا يرسل
        اتصالًا.
      </p>
      <p className="error" id="profile-error" role="alert">
        {problem}
      </p>
      <ProductionNotice operation="profile" onConfirmed={onSaved} />
      <button type="submit" className="btn full gap-top" disabled={blocked}>
        حفظ البيانات <Icon name="check" small />
      </button>
    </form>
  );
}

function GuestEntry() {
  const production = useCustomerProduction();
  const [recover, setRecover] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!production) return null;
  const { client, snapshot } = production;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (snapshot.busy) return;
    setProblem(null);
    void client.guest(recover ? code : undefined).then((result) => {
      setProblem(productionFailure(result));
      if (result.ok) setCode('');
    });
  };
  return (
    <form noValidate onSubmit={submit}>
      <p className="sheet-intro">
        يمكنك حفظ بياناتك وسياراتك بجلسة ضيف، دون إنشاء حساب أو كلمة مرور.
      </p>
      {recover ? (
        <label className="field">
          <span className="field-label">رمز استعادة جلسة الضيف</span>
          <input
            className="input ltr"
            type="password"
            name="recoveryCode"
            autoComplete="off"
            maxLength={43}
            value={code}
            disabled={snapshot.busy}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      ) : null}
      <p className="error" role="alert">
        {problem}
      </p>
      <ProductionNotice />
      <button className="btn full gap-top" type="submit" disabled={snapshot.busy}>
        {recover ? 'استعادة الجلسة' : 'متابعة كضيف'}
      </button>
      <button
        className="btn secondary full"
        type="button"
        disabled={snapshot.busy}
        onClick={() => {
          setRecover(!recover);
          setProblem(null);
          setCode('');
        }}
      >
        {recover ? 'إنشاء جلسة ضيف جديدة' : 'لدي رمز استعادة'}
      </button>
    </form>
  );
}

/** Ports the reference's profileSheet; guest entry/receipt uses its existing field and sheet components. */
export function CustomerProfileSheet({ open, onClose, onSaved }: Props) {
  const production = useCustomerProduction();
  if (!production) return null;
  const { client, snapshot } = production;
  const saved = () => {
    onClose();
    onSaved?.();
  };
  const recovery = snapshot.recovery;
  const key = recovery
    ? 'recovery-receipt'
    : snapshot.authStatus === 'anonymous'
      ? 'guest-entry'
      : snapshot.loading && snapshot.profileStatus === 'unavailable'
        ? 'loading'
        : `profile-${snapshot.session?.subject ?? 'unavailable'}`;
  return (
    <Sheet open={open} title="بيانات التواصل" onClose={onClose} contentKey={key}>
      {recovery ? (
        <>
          <p className="sheet-intro">
            احفظ رمز الاستعادة في مكان خاص. يُعرض عند إصدار الجلسة فقط، ولا نحفظ نسخة منه في هذا
            الجهاز.
          </p>
          <label className="field">
            <span className="field-label">رمز استعادة جلسة الضيف</span>
            <input
              className="input ltr"
              readOnly
              value={recovery.recoveryCode}
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <p className="input-note">
            تنتهي جلسة الضيف في{' '}
            {new Date(recovery.guestExpiresAt).toLocaleDateString('ar-SY', { timeZone: 'UTC' })}.
            استعادة الجلسة تستبدل الرمز وتنهي الجلسات السابقة.
          </p>
          <button
            className="btn full gap-top"
            type="button"
            onClick={() => client.acknowledgeRecovery()}
          >
            حفظت الرمز، متابعة
          </button>
        </>
      ) : snapshot.authStatus === 'anonymous' ? (
        <GuestEntry />
      ) : (snapshot.loading && snapshot.profileStatus === 'unavailable') ||
        snapshot.authStatus === 'loading' ? (
        <p role="status" className="sheet-intro">
          جارٍ تحميل بيانات الجلسة…
        </p>
      ) : snapshot.authStatus !== 'authenticated' || snapshot.profileStatus === 'unavailable' ? (
        <>
          <p className="error" role="alert">
            تعذّر تحميل بيانات الجلسة أو الملف. لا تُنشأ جلسة بديلة تلقائيًا.
          </p>
          <button
            className="btn full gap-top"
            type="button"
            disabled={snapshot.busy}
            onClick={() => void client.load()}
          >
            إعادة تحميل البيانات
          </button>
        </>
      ) : (
        <>
          <ProfileFields
            key={`${snapshot.session?.sessionId}:${snapshot.session?.authVersion}`}
            profile={snapshot.profile}
            onSaved={saved}
          />
          {snapshot.session?.principalKind === 'guest' ? (
            <p className="input-note">
              البيانات مرتبطة بجلسة ضيف. رقم التواصل لا يحوّلها إلى حساب.
            </p>
          ) : null}
        </>
      )}
      {snapshot.authStatus === 'authenticated' ? (
        <button
          className="text-btn danger full"
          type="button"
          disabled={snapshot.busy}
          onClick={() => void client.signOut()}
        >
          إنهاء الجلسة
        </button>
      ) : null}
    </Sheet>
  );
}
