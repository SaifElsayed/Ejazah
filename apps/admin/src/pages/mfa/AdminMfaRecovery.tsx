// T070 (ADR 0019 D3): the second factor by a recovery code (`AdminMfaRecovery`), one of the ten
// saved at setup, each spent on use (`auth.mfa.recover`). A wrong or spent code says so in place; a
// session that ended meanwhile starts again at the sign-in page.
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';

import { AuthCard, Banner, Button, Field, Input } from '../../design/components';
import { useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { AUTH_PATHS } from '../../lib/session';
import { useStartOver } from './start-over';

export function AdminMfaRecovery() {
  const t = useT();
  const { client, sessions } = useAdmin();
  const navigate = useNavigate();
  const startOver = useStartOver();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);

  async function recover(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await client.api.auth.mfa.recover.mutate({
        sessionToken: sessions.read()?.token ?? '',
        recoveryCode: code.trim(),
      });
      sessions.setStep('verified');
    } catch (error) {
      if (startOver(error)) return;
      setFailure(
        errorCodeOf(error) === 'CODE_INVALID'
          ? { key: 'admin.mfaRecovery.codeInvalid' }
          : errorMessageKey(error, 'admin.mfa.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.mfaRecovery.title')} lede={t('admin.mfaRecovery.lede')}>
      <form className="stack gap-4" onSubmit={(event) => void recover(event)}>
        <Field label={t('admin.mfaRecovery.codeLabel')} hint={t('admin.mfaRecovery.lostHint')}>
          <Input value={code} onChangeText={setCode} ltr error={failure?.key === 'admin.mfaRecovery.codeInvalid'} />
        </Field>
        {failure === null ? null : (
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t(failure.key, failure.values)}
          </Banner>
        )}
        <div className="row row--center">
          <Button
            label={t('admin.mfaRecovery.backToAppCode')}
            variant="ghost"
            onPress={() => void navigate(AUTH_PATHS.mfa)}
          />
        </div>
        <div className="stack gap-2">
          <Button
            label={t('admin.mfaRecovery.signIn')}
            layout="block"
            submit
            loading={busy}
            disabled={code.trim() === ''}
            onPress={() => undefined}
          />
          <Button
            label={t('admin.mfaRecovery.backToSignIn')}
            variant="ghost"
            layout="block"
            onPress={() => sessions.clear()}
          />
        </div>
      </form>
    </AuthCard>
  );
}
