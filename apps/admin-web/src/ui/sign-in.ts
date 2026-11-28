import {
  prepareCsrf,
  startLogin,
  verifyCode,
  resendCode,
  currentSession,
  type ChallengeReceipt,
} from '../api/session';
import type { StaffSession } from '../domain/access';
import { h } from './dom';
import { copy, lang } from './i18n';
import { openModal } from './shell';
import { failureMessage } from './states';

/** Functional sign-in extension D2-SD-02, using the reference modal and fields. */
export function signIn(onSignedIn: (session: StaffSession) => void): void {
  const c = copy();
  const tr = (ar: string, en: string): string => (lang() === 'ar' ? ar : en);
  const email = h('input', {
    type: 'email',
    name: 'email',
    autocomplete: 'username',
    required: true,
    maxlength: '254',
    dir: 'ltr',
  });
  const password = h('input', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    required: true,
    maxlength: '128',
    dir: 'ltr',
  });
  const code = h('input', {
    name: 'code',
    inputmode: 'numeric',
    pattern: '[0-9]{6}',
    maxlength: '6',
    autocomplete: 'one-time-code',
    disabled: true,
    dir: 'ltr',
  });
  const problem = h('p', { class: 'field-error', id: 'signInProblem', role: 'alert' });
  const timing = h('p', { role: 'status', 'aria-live': 'polite' });
  const submit = h(
    'button',
    { class: 'primary', type: 'submit', id: 'signInSubmit', form: 'adminSignIn' },
    c.continue,
  );
  const resend = h(
    'button',
    { class: 'ghost', type: 'button', hidden: true },
    tr('إعادة إرسال الرمز', 'Resend code'),
  );
  const restart = h(
    'button',
    { class: 'ghost', type: 'button', hidden: true },
    tr('استخدام حساب آخر', 'Use another account'),
  );
  const form = h(
    'form',
    { id: 'adminSignIn', 'aria-busy': 'false' },
    h('label', {}, c.email, email),
    h('label', {}, c.password, password),
    h('label', {}, c.code, code),
    timing,
    problem,
  );
  let receipt: ChallengeReceipt | null = null;
  let expiresAt = 0;
  let resendAt = 0;
  let busy = false;
  let active = true;
  const update = (): void => {
    form.setAttribute('aria-busy', String(busy));
    submit.disabled = busy || (receipt !== null && Date.now() >= expiresAt);
    resend.disabled = busy || Date.now() < resendAt;
    restart.disabled = busy;
    if (receipt)
      timing.textContent =
        Date.now() >= expiresAt
          ? tr('انتهت صلاحية الرمز. اطلب رمزًا جديدًا.', 'The code expired. Request another code.')
          : Date.now() < resendAt
            ? tr('انتظر قليلًا قبل إعادة الإرسال.', 'Please wait before resending.')
            : tr('يمكنك طلب رمز جديد الآن.', 'You can request another code now.');
  };
  const accept = (next: ChallengeReceipt): void => {
    receipt = next;
    expiresAt = Date.now() + next.expiresIn * 1000;
    resendAt = Date.now() + next.resendAfter * 1000;
    password.value = '';
    email.disabled = password.disabled = true;
    code.disabled = false;
    code.required = true;
    code.value = '';
    resend.hidden = restart.hidden = false;
    submit.textContent = c.verify;
    code.focus();
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    busy = true;
    problem.textContent = '';
    update();
    void (async () => {
      try {
        if (!receipt) {
          const csrf = await prepareCsrf();
          if (!active) return;
          if (!csrf.ok) {
            problem.textContent = failureMessage(csrf.failure);
            return;
          }
          const result = await startLogin(email.value.trim(), password.value);
          password.value = '';
          if (!active) return;
          if (result.ok) accept(result.value);
          else
            problem.textContent =
              result.failure === 'RATE_LIMITED' ? failureMessage(result.failure) : c.signInFailed;
        } else {
          let result = await verifyCode(receipt.challengeId, code.value.trim());
          if (!result.ok && result.failure === 'UNKNOWN_OUTCOME') result = await currentSession();
          if (!active) return;
          if (result.ok) {
            code.value = '';
            onSignedIn(result.value);
          } else
            problem.textContent =
              result.failure === 'RATE_LIMITED' ? failureMessage(result.failure) : c.signInFailed;
        }
      } finally {
        busy = false;
        if (active) update();
      }
    })();
  });
  resend.addEventListener('click', () => {
    if (!receipt || busy || Date.now() < resendAt) return;
    busy = true;
    problem.textContent = '';
    update();
    void resendCode(receipt.challengeId)
      .then((result) => {
        if (!active) return;
        if (result.ok) accept(result.value);
        else problem.textContent = failureMessage(result.failure);
      })
      .finally(() => {
        busy = false;
        if (active) update();
      });
  });
  restart.addEventListener('click', () => {
    if (busy) return;
    receipt = null;
    password.value = code.value = '';
    code.disabled = true;
    code.required = false;
    email.disabled = password.disabled = false;
    resend.hidden = restart.hidden = true;
    submit.textContent = c.continue;
    problem.textContent = timing.textContent = '';
    update();
    email.focus();
  });
  const timer = setInterval(update, 1000);
  openModal({
    title: c.signIn,
    body: [form],
    foot: [submit, resend, restart],
    onClose: () => {
      active = false;
      clearInterval(timer);
      password.value = code.value = '';
      receipt = null;
    },
  });
}
