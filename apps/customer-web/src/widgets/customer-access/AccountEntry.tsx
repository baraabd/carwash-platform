import { useEffect, useState, type FormEvent } from 'react';
import { useCustomerProduction } from '../../data/CustomerProductionProvider';
import { currentInstant } from '../../shared/clock';

/** Uses the existing Identity email/password + OTP flow; no local token or OTP storage. */
export function AccountEntry({ onGuest }: { readonly onGuest: () => void }) {
  const production = useCustomerProduction();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => currentInstant().getTime());
  const challenge = production?.snapshot.challenge;
  useEffect(() => {
    if (!challenge) return;
    const timer = window.setInterval(() => setNow(currentInstant().getTime()), 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);
  if (!production) return null;
  const { client, snapshot } = production;
  const busy = snapshot.busy || snapshot.loading;
  const remaining = challenge
    ? Math.max(0, Math.ceil((challenge.receivedAt + challenge.resendAfter * 1000 - now) / 1000))
    : 0;
  const expired = challenge ? now >= challenge.receivedAt + challenge.expiresIn * 1000 : false;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setProblem(null);
    const operation = challenge
      ? client.verifyChallenge(code)
      : client.account(mode, email, password);
    setPassword('');
    setCode('');
    void operation.then((result) => {
      if (result.ok) {
        setNow(currentInstant().getTime());
        return;
      }
      setProblem(
        result.status === 429
          ? 'انتظر قليلًا قبل المحاولة مجددًا.'
          : result.error.code === 'OUTCOME_UNKNOWN'
            ? 'تعذّر تأكيد النتيجة. أعد تحميل الجلسة قبل محاولة جديدة.'
            : challenge
              ? 'تعذّر التحقق من الرمز. راجع الرمز وصلاحيته أو اطلب إرساله مجددًا.'
              : 'تعذّر بدء الدخول. راجع البريد وكلمة المرور أو حاول لاحقًا.',
      );
    });
  };
  return (
    <form noValidate onSubmit={submit}>
      <p className="sheet-intro">
        {challenge
          ? 'أدخل رمز التحقق المرسل إلى بريدك الإلكتروني.'
          : 'ادخل إلى حسابك لحفظ بياناتك ومتابعة حجوزاتك.'}
      </p>
      {!challenge ? (
        <>
          <div className="segmented" role="group" aria-label="الدخول إلى الحساب">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              aria-pressed={mode === 'login'}
              disabled={busy}
              onClick={() => {
                setMode('login');
                setProblem(null);
              }}
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              aria-pressed={mode === 'register'}
              disabled={busy}
              onClick={() => {
                setMode('register');
                setProblem(null);
              }}
            >
              حساب جديد
            </button>
          </div>
          <label className="field">
            <span className="field-label">البريد الإلكتروني</span>
            <input
              className="input ltr"
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">كلمة المرور</span>
            <input
              className="input ltr"
              type="password"
              name="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={12}
              maxLength={128}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p className="input-note">
            كلمة المرور من 12 إلى 128 حرفًا. نرسل رمز تحقق قبل فتح الجلسة.
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span className="field-label">رمز التحقق</span>
            <input
              className="input ltr"
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={busy || expired}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          {expired ? (
            <p className="error" role="alert">
              انتهت صلاحية الرمز. اطلب رمزًا جديدًا.
            </p>
          ) : null}
          <button
            className="text-btn"
            type="button"
            disabled={busy || remaining > 0}
            onClick={() => {
              setProblem(null);
              setCode('');
              void client.resendChallenge().then((result) => {
                setNow(currentInstant().getTime());
                if (!result.ok)
                  setProblem('تعذّر إرسال الرمز. انتظر قليلًا أو ابدأ الدخول من جديد.');
              });
            }}
          >
            {remaining ? `إعادة الإرسال بعد ${remaining} ثانية` : 'إعادة إرسال الرمز'}
          </button>
        </>
      )}
      <p className="error" role="alert">
        {problem}
      </p>
      <button
        className="btn full gap-top"
        type="submit"
        disabled={busy || Boolean(challenge && expired)}
      >
        {busy
          ? 'جارٍ التحقق…'
          : challenge
            ? 'تأكيد الرمز'
            : mode === 'register'
              ? 'إنشاء الحساب'
              : 'متابعة الدخول'}
      </button>
      {challenge ? (
        <button
          className="btn secondary full"
          type="button"
          disabled={busy}
          onClick={() => {
            client.cancelChallenge();
            setCode('');
            setProblem(null);
          }}
        >
          العودة إلى بيانات الدخول
        </button>
      ) : null}
      <button
        className="btn secondary full"
        type="button"
        disabled={busy}
        onClick={() => {
          client.cancelChallenge();
          onGuest();
        }}
      >
        متابعة كضيف أو استعادة جلسة الضيف
      </button>
    </form>
  );
}
