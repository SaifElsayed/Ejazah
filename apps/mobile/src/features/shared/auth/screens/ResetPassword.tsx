// T050 (FR-AUTH-6, FR-128): the code and the new password on one screen; saving signs in and the
// server revokes every other session (`password_reset`). A wrong or spent code is said under the
// cells, a breached password under the password; neither says whether the address has an account
// (ForgotPassword's sentence, `auth.forgotPassword.sentAny`, stands above).
import { PASSWORD_MIN_LENGTH } from '@ijazah/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Input,
  Otp as OtpCells,
  PageIntro,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, type MessageValues, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { genericErrorKey } from '../../../../lib/error-message';
import { BackBar, StackScreen } from '../../screen';
import { useAuthApi } from '../api';
import { Resend, useCountdown } from '../components/parts';
import { getPendingEmail } from '../pending';

const CODE_LENGTH = 6;

type Problem = {
  readonly field: 'code' | 'password' | 'confirm' | 'form';
  readonly key: MessageKey;
  readonly values?: MessageValues;
};

export function ResetPassword() {
  const t = useT();
  const auth = useAuthApi();
  const email = getPendingEmail()?.email ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const countdown = useCountdown();

  const save = async () => {
    if (password.length < PASSWORD_MIN_LENGTH) {
      setProblem({ field: 'password', key: 'auth.password.minLength' });
      return;
    }
    if (password !== confirm) {
      setProblem({ field: 'confirm', key: 'auth.password.mismatch' });
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await auth.resetPassword(email, code, password);
    } catch (caught: unknown) {
      const code = errorCodeOf(caught);
      setProblem(
        code === 'CODE_INVALID'
          ? { field: 'code', key: 'auth.otp.invalid' }
          : code === 'PASSWORD_WEAK'
            ? { field: 'password', key: 'auth.password.weak' }
            : { field: 'form', ...genericErrorKey(caught, 'common.state.actionError') },
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    countdown.restart();
    try {
      await auth.requestPasswordReset(email);
    } catch (caught: unknown) {
      setProblem({ field: 'form', ...genericErrorKey(caught, 'common.state.actionError') });
    }
  };

  const errorOf = (field: Problem['field']) =>
    problem?.field === field ? { error: t(problem.key) } : {};

  return (
    <StackScreen
      header={<BackBar onPress={() => router.back()} />}
      footer={
        <ActionBar>
          <Button
            label={t('auth.resetPassword.save')}
            layout="block"
            loading={busy}
            disabled={busy || code.length !== CODE_LENGTH || password === ''}
            onPress={() => void save()}
          />
        </ActionBar>
      }
    >
      <PageIntro
        title={t('auth.resetPassword.title')}
        lede={t('auth.resetPassword.lede', { email })}
      />
      <Text variant="callout" tone="muted">
        {t('auth.forgotPassword.sentAny')}
      </Text>
      {problem?.field === 'form' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(problem.key, problem.values)}
        </Banner>
      ) : null}
      <View style={{ gap: tokens.space['2'] }}>
        <Field label={t('auth.resetPassword.code')} {...errorOf('code')}>
          <OtpCells value={code} onChange={setCode} error={problem?.field === 'code'} />
        </Field>
        <Resend
          left={countdown.left}
          waitingKey="auth.resetPassword.resendIn"
          onResend={() => void resend()}
        />
      </View>
      <Field label={t('auth.field.newPassword')} {...errorOf('password')}>
        <Input value={password} onChangeText={setPassword} secure ltr />
      </Field>
      <Field label={t('auth.field.confirmPassword')} {...errorOf('confirm')}>
        <Input value={confirm} onChangeText={setConfirm} secure ltr />
      </Field>
    </StackScreen>
  );
}
