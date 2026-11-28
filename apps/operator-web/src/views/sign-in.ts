import type { ChallengeReceipt } from '@carwash/contracts';
import { resendCode, startLogin, verifyCode } from '../api/auth-api';
import { readSession } from '../api/operator-api';
import type { Result } from '../api/client';
import { I, setHtml } from '../dom';

/** Identity owns credentials and OTP. Only the challenge receipt stays in memory. */
export function mountSignIn(host: HTMLElement, signedIn: () => Promise<void>): () => void {
  setHtml(
    host,
    `<section class="profile-head"><div class="avatar">${I('user')}</div><h1>دخول الفني</h1><p>استخدم حساب العمل الممنوح لك من الإدارة.</p></section>
    <form class="card" id="operatorSignIn" aria-busy="false">
      <label class="field-label" for="operatorEmail">البريد الإلكتروني</label>
      <input class="input" id="operatorEmail" name="email" type="email" autocomplete="username" dir="ltr" required maxlength="254">
      <label class="field-label" for="operatorPassword">كلمة المرور</label>
      <input class="input" id="operatorPassword" name="password" type="password" autocomplete="current-password" dir="ltr" required maxlength="256">
      <div id="operatorCodeStep" hidden><label class="field-label" for="operatorCode">رمز التحقق</label>
        <input class="input" id="operatorCode" name="code" inputmode="numeric" autocomplete="one-time-code" dir="ltr" pattern="[0-9]{6}" maxlength="6" disabled>
        <p class="field-hint" id="operatorCodeTimer" aria-live="polite"></p></div>
      <p class="sheet-error" id="operatorSignInProblem" role="alert" hidden></p>
      <button class="btn mt" type="submit" id="operatorSignInSubmit">متابعة</button>
      <button class="btn outline" type="button" id="operatorResend" hidden>إعادة إرسال الرمز</button>
      <button class="btn soft" type="button" id="operatorRestart" hidden>استخدام حساب آخر</button>
    </form>`,
  );
  const get = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!;
  const form = get<HTMLFormElement>('#operatorSignIn');
  const email = get<HTMLInputElement>('#operatorEmail');
  const password = get<HTMLInputElement>('#operatorPassword');
  const code = get<HTMLInputElement>('#operatorCode');
  const submit = get<HTMLButtonElement>('#operatorSignInSubmit');
  const resend = get<HTMLButtonElement>('#operatorResend');
  const restart = get<HTMLButtonElement>('#operatorRestart');
  const problem = get<HTMLParagraphElement>('#operatorSignInProblem');
  let receipt: ChallengeReceipt | null = null;
  let expiresAt = 0;
  let resendAt = 0;
  let busy = false;
  let active = true;
  const showError = (message: string): void => {
    problem.textContent = message;
    problem.hidden = !message;
  };
  const failure = (result: Exclude<Result<unknown>, { kind: 'ok' }>): string =>
    result.kind === 'unknown'
      ? 'تعذر التأكد من نتيجة الطلب. تحقق من الاتصال وحاول مجددًا.'
      : result.status === 429
        ? 'محاولات كثيرة. انتظر قليلًا قبل المحاولة مجددًا.'
        : result.status >= 500
          ? 'خدمة الدخول غير متاحة مؤقتًا. حاول مجددًا.'
          : 'تعذر التحقق من البيانات أو الرمز. تحقق من المدخلات وحاول مجددًا.';
  const update = (): void => {
    form.setAttribute('aria-busy', String(busy));
    const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    resend.disabled = busy || remaining > 0;
    restart.disabled = busy;
    submit.disabled = busy || (receipt !== null && Date.now() >= expiresAt);
    if (receipt)
      get('#operatorCodeTimer').textContent =
        Date.now() >= expiresAt
          ? 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.'
          : remaining
            ? `يمكنك إعادة إرسال الرمز بعد ${remaining} ثانية.`
            : 'يمكنك طلب رمز جديد الآن.';
  };
  const acceptChallenge = (next: ChallengeReceipt): void => {
    receipt = next;
    expiresAt = Date.now() + next.expiresIn * 1000;
    resendAt = Date.now() + next.resendAfter * 1000;
    password.value = '';
    email.disabled = password.disabled = true;
    code.disabled = false;
    code.required = true;
    code.value = '';
    get('#operatorCodeStep').hidden = false;
    resend.hidden = restart.hidden = false;
    submit.textContent = 'تحقق وسجّل الدخول';
    code.focus();
  };
  const run = async (): Promise<void> => {
    if (busy || !form.reportValidity()) return;
    busy = true;
    showError('');
    update();
    try {
      if (!receipt) {
        const result = await startLogin(email.value.trim(), password.value);
        password.value = '';
        if (!active) return;
        if (result.kind === 'ok') acceptChallenge(result.value);
        else showError(failure(result));
      } else {
        let result = await verifyCode(receipt.challengeId, code.value.trim());
        if (result.kind === 'unknown') result = await readSession();
        if (!active) return;
        if (result.kind === 'ok') {
          if (
            result.value.principalKind !== 'account' ||
            !result.value.permissions.includes('work.read:assigned')
          )
            showError('هذا الحساب لا يملك صلاحية مهام الفني. استخدم حساب العمل الممنوح لك.');
          else {
            code.value = '';
            await signedIn();
          }
        } else showError(failure(result));
      }
    } finally {
      busy = false;
      if (active) update();
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  resend.addEventListener('click', () => {
    if (!receipt || busy || Date.now() < resendAt) return;
    const challengeId = receipt.challengeId;
    busy = true;
    showError('');
    update();
    void resendCode(challengeId)
      .then((result) => {
        if (!active) return;
        if (result.kind === 'ok') acceptChallenge(result.value);
        else showError(failure(result));
      })
      .finally(() => {
        busy = false;
        if (active) update();
      });
  });
  restart.addEventListener('click', () => {
    if (busy) return;
    receipt = null;
    code.value = '';
    code.disabled = true;
    code.required = false;
    password.value = '';
    email.disabled = password.disabled = false;
    get('#operatorCodeStep').hidden = true;
    resend.hidden = restart.hidden = true;
    submit.textContent = 'متابعة';
    showError('');
    update();
    email.focus();
  });
  const timer = setInterval(update, 1000);
  email.focus();
  return () => {
    active = false;
    clearInterval(timer);
    password.value = '';
    code.value = '';
    receipt = null;
  };
}
