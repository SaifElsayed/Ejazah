// T050 (FR-AUTH-1, ADR 0012 D1): the code that proves the new account's address. Six cells, the
// confirm button once six digits are in, the resend countdown and the way back to change the
// address. A proved address starts the onboarding (Role); one another method already holds opens
// the conflict sheet, told only now that the mailbox is proved (app-surface.md). T097: one that
// belongs to a banned person's deleted account lands on the signed-out banned state.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Otp as OtpCells,
  PageIntro,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { BackBar, StackScreen } from '../../screen';
import { BANNED_ROUTE, useAuthApi } from '../api';
import { type SignInConflict, SignInConflictSheet } from '../components/SignInConflictSheet';
import { Resend, useCountdown } from '../components/parts';
import { getPendingEmail } from '../pending';

const CODE_LENGTH = 6;

export function Otp() {
  const t = useT();
  const auth = useAuthApi();
  const pending = getPendingEmail();
  const email = pending?.email ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<'code' | ErrorMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<SignInConflict | null>(null);
  const countdown = useCountdown();

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const outcome = await auth.verifySignUpCode(email, code, pending?.password ?? '');
      if (outcome.kind === 'onboarding') router.push('/(auth)/role');
      if (outcome.kind === 'conflict') setConflict(outcome);
      if (outcome.kind === 'banned') router.replace(BANNED_ROUTE);
    } catch (caught: unknown) {
      setError(
        errorCodeOf(caught) === 'CODE_INVALID'
          ? 'code'
          : genericErrorKey(caught, 'common.state.actionError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    countdown.restart();
    try {
      await auth.requestSignUpCode(email);
    } catch (caught: unknown) {
      setError(genericErrorKey(caught, 'common.state.actionError'));
    }
  };

  return (
    <StackScreen
      header={<BackBar onPress={() => router.back()} />}
      footer={
        <ActionBar>
          <Button
            label={t('auth.otp.confirm')}
            layout="block"
            loading={busy}
            disabled={busy || code.length !== CODE_LENGTH}
            onPress={() => void confirm()}
          />
          <View style={{ alignSelf: 'center' }}>
            <TextLink label={t('auth.otp.changeEmail')} onPress={() => router.back()} />
          </View>
        </ActionBar>
      }
    >
      <PageIntro title={t('auth.otp.title')} lede={t('auth.otp.lede', { email })} />
      {error !== null && error !== 'code' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(error.key, error.values)}
        </Banner>
      ) : null}
      <View style={{ gap: tokens.space['3'] }}>
        <Field
          label={t('auth.otp.code')}
          {...(error === 'code' ? { error: t('auth.otp.invalid') } : {})}
        >
          <OtpCells value={code} onChange={setCode} error={error === 'code'} />
        </Field>
        <Resend
          left={countdown.left}
          waitingKey="auth.otp.resendIn"
          onResend={() => void resend()}
        />
      </View>
      <SignInConflictSheet
        conflict={conflict}
        onClose={() => setConflict(null)}
        onProvider={() => router.replace('/(auth)/welcome')}
      />
    </StackScreen>
  );
}
