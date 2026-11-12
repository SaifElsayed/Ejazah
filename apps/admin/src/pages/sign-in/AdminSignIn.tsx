// T070 (FR-170, ADR 0019 D3): the panel's sign-in (`AdminSignIn`). The email and the password open
// a session waiting for its second factor, or for its setup on a first sign-in (`auth.signIn`'s
// `next`); the guard (lib/session.ts) then lands it on `/mfa` or `/mfa/setup`. A refused sign-in
// is `AdminSignInError`: one message whatever the reason, the email kept and the password cleared.
// The page also says what brought a person back to it: the password the invite link set, or a
// waiting session that ended (`SignInNotice`). The first comes in the router's state. The second
// cannot: forgetting the session re-renders the guard at once, and its own redirect to this page
// carries no state, so the second-factor page leaves the notice here (`leaveSignInNotice`) before
// it forgets the session, and this page takes it once.
import { type FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { AuthCard, Banner, Button, Field, Input } from '../../design/components';
import { useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

/** Why a page sent the person back to the sign-in page. */
export type SignInNotice = 'passwordSet' | 'sessionExpired';

let left: SignInNotice | undefined;

/** Leaves `notice` for the sign-in page's next showing. */
export function leaveSignInNotice(notice: SignInNotice): void {
  left = notice;
}

export function AdminSignIn() {
  const t = useT();
  const { client, sessions } = useAdmin();
  const state: unknown = useLocation().state;
  const [notice] = useState(() => noticeOf(state) ?? left);
  useEffect(() => {
    left = undefined;
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<ErrorMessage | null>(null);

  async function signIn(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      const { next, sessionToken } = await client.api.auth.signIn.mutate({
        email: email.trim(),
        password,
      });
      sessions.write({ token: sessionToken, step: next });
    } catch (error) {
      setPassword('');
      setFailed(errorMessageKey(error, 'admin.signIn.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.signIn.title')} lede={t('admin.signIn.lede')}>
      <form className="stack gap-4" onSubmit={(event) => void signIn(event)}>
        {failed !== null ? (
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t(failed.key, failed.values)}
          </Banner>
        ) : notice === undefined ? null : (
          <Banner
            icon={{ name: notice === 'passwordSet' ? 'circle-check' : 'info' }}
            tone={notice === 'passwordSet' ? 'success' : 'info'}
          >
            {t(
              notice === 'passwordSet' ? 'admin.signIn.passwordSet' : 'admin.signIn.sessionExpired',
            )}
          </Banner>
        )}
        <Field label={t('admin.signIn.email')}>
          <Input value={email} onChangeText={setEmail} keyboard="email" ltr />
        </Field>
        <Field label={t('admin.signIn.password')}>
          <Input value={password} onChangeText={setPassword} secure ltr />
        </Field>
        <Button
          label={t('admin.signIn.continue')}
          layout="block"
          submit
          loading={busy}
          disabled={email.trim() === '' || password === ''}
          onPress={() => undefined}
        />
      </form>
    </AuthCard>
  );
}

function noticeOf(state: unknown): SignInNotice | undefined {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return undefined;
  const { notice } = state;
  return notice === 'passwordSet' || notice === 'sessionExpired' ? notice : undefined;
}
