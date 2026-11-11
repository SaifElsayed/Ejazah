// T050 (FR-AUTH-6, ADR 0012 D1; decision 4): the forgotten password. The same answer, the same work
// and the same timing for every address (the server's), so the screen moves on to the new password
// whatever the address, saying only that a code came if the address has a password.
import { emailAddress } from '@ijazah/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Input,
  PageIntro,
  TextLink,
} from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { BackBar, StackScreen } from '../../screen';
import { useAuthApi } from '../api';
import { setPendingEmail } from '../pending';

export function ForgotPassword() {
  const t = useT();
  const auth = useAuthApi();
  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setFailure(null);
    const address = email.trim();
    setInvalid(!emailAddress.safeParse(address).success);
    if (!emailAddress.safeParse(address).success) return;
    setBusy(true);
    try {
      await auth.requestPasswordReset(address);
      setPendingEmail(address);
      router.push('/(auth)/reset-password');
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StackScreen
      header={<BackBar onPress={() => router.back()} />}
      footer={
        <ActionBar>
          <Button
            label={t('auth.forgotPassword.sendCode')}
            layout="block"
            loading={busy}
            disabled={busy || email.trim() === ''}
            onPress={() => void send()}
          />
          <View style={{ alignSelf: 'center' }}>
            <TextLink
              label={t('auth.forgotPassword.otherMethod')}
              onPress={() => router.replace('/(auth)/welcome')}
            />
          </View>
        </ActionBar>
      }
    >
      <PageIntro title={t('auth.forgotPassword.title')} lede={t('auth.forgotPassword.lede')} />
      {failure !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      ) : null}
      <Field
        label={t('auth.field.email')}
        {...(invalid ? { error: t('auth.field.emailInvalid') } : {})}
      >
        <Input value={email} onChangeText={setEmail} keyboard="email" ltr />
      </Field>
    </StackScreen>
  );
}
