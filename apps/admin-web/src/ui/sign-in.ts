import { prepareCsrf, startLogin, verifyCode } from '../api/session';
import type { StaffSession } from '../domain/access';
import { h } from './dom';
import { copy } from './i18n';
import { openModal } from './shell';
import { failureMessage } from './states';

/**
 * Staff sign-in in the reference's modal component. There is no approved
 * admin sign-in design yet (declared difference D2-SD-02); this uses only the
 * reference modal and form-field styles. Identity owns every check.
 */
export function signIn(onSignedIn: (session: StaffSession) => void): void {
  const c = copy();
  const email = h('input', {
    type: 'email',
    name: 'email',
    autocomplete: 'username',
    required: true,
    dir: 'ltr',
  });
  const password = h('input', {
    type: 'password',
    name: 'password',
    autocomplete: 'current-password',
    required: true,
    dir: 'ltr',
  });
  const code = h('input', {
    name: 'code',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    disabled: true,
    dir: 'ltr',
  });
  const problem = h('p', { class: 'field-error', id: 'signInProblem', role: 'alert' });
  const submit = h('button', { class: 'primary', type: 'button', id: 'signInSubmit' }, c.continue);
  let challengeId: string | null = null;

  const run = async (): Promise<void> => {
    problem.textContent = '';
    submit.disabled = true;
    try {
      if (challengeId === null) {
        const csrf = await prepareCsrf();
        if (!csrf.ok) {
          problem.textContent = failureMessage(csrf.failure);
          return;
        }
        const started = await startLogin(email.value.trim(), password.value);
        if (!started.ok) {
          problem.textContent =
            started.failure === 'RATE_LIMITED' ? failureMessage(started.failure) : c.signInFailed;
          return;
        }
        challengeId = started.value;
        password.value = '';
        email.disabled = true;
        password.disabled = true;
        code.disabled = false;
        submit.textContent = c.verify;
        code.focus();
        return;
      }
      const verified = await verifyCode(challengeId, code.value.trim());
      if (!verified.ok) {
        problem.textContent =
          verified.failure === 'RATE_LIMITED' ? failureMessage(verified.failure) : c.signInFailed;
        return;
      }
      onSignedIn(verified.value);
    } finally {
      submit.disabled = false;
    }
  };
  submit.addEventListener('click', () => void run());
  for (const input of [email, password, code])
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void run();
    });

  openModal({
    title: c.signIn,
    body: [
      h('label', {}, c.email, email),
      h('label', {}, c.password, password),
      h('label', {}, c.code, code),
      problem,
    ],
    foot: [submit],
  });
}
