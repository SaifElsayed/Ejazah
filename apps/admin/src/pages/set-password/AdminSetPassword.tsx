// T070 (R-110, FR-170): the invite link's page (`/set-password`), undrawn; it follows the sign-in
// card (owner's decision at B14's conflict check, 2026-10-22). The link carries a single-use token
// in its fragment (`#token=…`, never sent to a server) or, from an older link, its query; the page
// reads it once and takes it out of the address (a replace, `history.replaceState` under the
// router), so it stays in no history entry. It works by the token, not by a session, so the route
// sits outside the guard and opens whoever is signed in. The password's bounds are the contract's;
// the server also refuses a breached one (`PASSWORD_WEAK`) and a spent, expired or forged token
// (`INVITE_INVALID`). Saved, the person signs in, and the sign-in page says the password is set.
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@ijazah/contracts';
import { type FormEvent, useEffect, useState } from 'react';
import { type Location, useLocation, useNavigate } from 'react-router';

import { AuthCard, Banner, Button, Field, Input } from '../../design/components';
import { type MessageKey, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { AUTH_PATHS } from '../../lib/session';
import type { SignInNotice } from '../sign-in/AdminSignIn';

export const SET_PASSWORD_PATH = '/set-password';

const FAILURE: Readonly<Record<string, MessageKey>> = {
  INVITE_INVALID: 'admin.setPassword.inviteInvalid',
  PASSWORD_WEAK: 'admin.setPassword.weak',
};

export function AdminSetPassword() {
  const t = useT();
  const { client } = useAdmin();
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => tokenOf(location));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);

  useEffect(() => {
    if (location.hash !== '' || location.search !== '') {
      void navigate(location.pathname, { replace: true });
    }
  }, [location, navigate]);

  const bounded = password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (token === null) return;
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setBusy(true);
    setFailure(null);
    try {
      await client.api.auth.setPassword.mutate({ inviteToken: token, password });
      const notice: SignInNotice = 'passwordSet';
      void navigate(AUTH_PATHS.signIn, { replace: true, state: { notice } });
    } catch (error) {
      setFailure(FAILURE[errorCodeOf(error) ?? ''] ?? 'admin.setPassword.failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.setPassword.title')} lede={t('admin.setPassword.lede')}>
      {token === null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('admin.setPassword.inviteInvalid')}
        </Banner>
      ) : (
        <form className="stack gap-4" onSubmit={(event) => void save(event)}>
          {failure === null ? null : (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t(failure)}
            </Banner>
          )}
          <Field
            label={t('admin.setPassword.password')}
            hint={t('admin.setPassword.hint', {
              min: PASSWORD_MIN_LENGTH,
              max: PASSWORD_MAX_LENGTH,
            })}
          >
            <Input value={password} onChangeText={setPassword} secure ltr />
          </Field>
          <Field
            label={t('admin.setPassword.confirm')}
            {...(mismatch ? { error: t('admin.setPassword.mismatch') } : {})}
          >
            <Input value={confirm} onChangeText={setConfirm} secure ltr />
          </Field>
          <Button
            label={t('admin.setPassword.save')}
            layout="block"
            submit
            loading={busy}
            disabled={!bounded || confirm === ''}
            onPress={() => undefined}
          />
        </form>
      )}
    </AuthCard>
  );
}

/** The invite token in the link's fragment, or its query; null when the link carries none. */
function tokenOf(location: Pick<Location, 'hash' | 'search'>): string | null {
  const token =
    new URLSearchParams(location.hash.replace(/^#/, '')).get('token') ??
    new URLSearchParams(location.search).get('token');
  return token === null || token === '' ? null : token;
}
