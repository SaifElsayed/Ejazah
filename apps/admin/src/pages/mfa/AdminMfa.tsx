// T070 (FR-171, NFR-SEC-6): the second factor by the authenticator's code (`AdminMfa`). Six digits
// verify the waiting session (`auth.mfa.verify`) and the guard takes it home; a wrong or spent code
// says so in place and the cells empty for the next one; a session that ended meanwhile starts
// again at the sign-in page. A lost phone takes the recovery-code page; «الرجوع إلى الدخول» forgets
// the waiting session.
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';

import { AuthCard, Banner, Button, Field, Otp } from '../../design/components';
import { useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { AUTH_PATHS } from '../../lib/session';
import { TOTP_PERIOD_SECONDS, useStartOver } from './start-over';

const CODE_LENGTH = 6;

export function AdminMfa() {
  const t = useT();
  const { client, sessions } = useAdmin();
  const navigate = useNavigate();
  const startOver = useStartOver();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);

  async function verify(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await client.api.auth.mfa.verify.mutate({ sessionToken: sessions.read()?.token ?? '', code });
      sessions.setStep('verified');
    } catch (error) {
      if (startOver(error)) return;
      setCode('');
      setFailure(
        errorCodeOf(error) === 'CODE_INVALID'
          ? { key: 'admin.mfa.codeInvalid' }
          : errorMessageKey(error, 'admin.mfa.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('admin.mfa.title')} lede={t('admin.mfa.lede')}>
      <form className="stack gap-4" onSubmit={(event) => void verify(event)}>
        <Field
          label={t('admin.mfa.codeLabel')}
          hint={t('admin.mfa.refreshHint', { seconds: TOTP_PERIOD_SECONDS })}
        >
          <Otp value={code} onChange={setCode} error={failure?.key === 'admin.mfa.codeInvalid'} />
        </Field>
        {failure === null ? null : (
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t(failure.key, failure.values)}
          </Banner>
        )}
        <div className="row row--center">
          <Button
            label={t('admin.mfa.useRecoveryCode')}
            variant="ghost"
            onPress={() => void navigate(AUTH_PATHS.recovery)}
          />
        </div>
        <div className="stack gap-2">
          <Button
            label={t('admin.mfa.signIn')}
            layout="block"
            submit
            loading={busy}
            disabled={code.length < CODE_LENGTH}
            onPress={() => undefined}
          />
          <Button
            label={t('admin.mfa.backToSignIn')}
            variant="ghost"
            layout="block"
            onPress={() => sessions.clear()}
          />
        </div>
      </form>
    </AuthCard>
  );
}
