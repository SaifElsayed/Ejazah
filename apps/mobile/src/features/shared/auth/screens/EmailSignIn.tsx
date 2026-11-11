// T050 (FR-AUTH-1, FR-AUTH-7): the email sign-in and its error state (EmailSignIn,
// EmailSignInError). One sentence for a wrong address or password, never which of the two
// (`SIGN_IN_FAILED`), announced under the password; any other failure is the generic banner.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Input,
  InputGroup,
  PageIntro,
  Text,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { BackBar, StackScreen } from '../../screen';
import { useAuthApi } from '../api';
import { FieldAlert } from '../components/parts';

export function EmailSignIn() {
  const t = useT();
  const auth = useAuthApi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'credentials' | ErrorMessage | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await auth.emailSignIn(email.trim(), password);
    } catch (caught: unknown) {
      setError(
        errorCodeOf(caught) === 'SIGN_IN_FAILED'
          ? 'credentials'
          : genericErrorKey(caught, 'common.state.actionError'),
      );
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
            label={t('auth.emailSignIn.signIn')}
            layout="block"
            loading={busy}
            disabled={busy || email.trim() === '' || password === ''}
            onPress={() => void submit()}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: tokens.space['1'] }}>
            <Text variant="callout" tone="muted">
              {t('auth.emailSignIn.noAccount')}
            </Text>
            <TextLink
              label={t('auth.emailSignIn.createAccount')}
              variant="strong"
              onPress={() => router.push('/(auth)/email-sign-up')}
            />
          </View>
        </ActionBar>
      }
    >
      <PageIntro title={t('auth.emailSignIn.title')} />
      {error !== null && error !== 'credentials' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(error.key, error.values)}
        </Banner>
      ) : null}
      <Field label={t('auth.field.email')}>
        <Input value={email} onChangeText={setEmail} keyboard="email" ltr />
      </Field>
      <View style={{ gap: tokens.space['2'] }}>
        <Field label={t('auth.field.password')}>
          <InputGroup
            value={password}
            onChangeText={setPassword}
            secure={!shown}
            ltr
            error={error === 'credentials'}
            trailing={{
              icon: { name: shown ? 'eye-off' : 'eye' },
              accessibilityLabel: t('auth.emailSignIn.a11y.showPassword'),
              onPress: () => setShown((value) => !value),
            }}
          />
        </Field>
        {error === 'credentials' ? (
          <FieldAlert message={t('auth.emailSignIn.error.invalidCredentials')} />
        ) : null}
        <View style={{ alignSelf: 'flex-start' }}>
          <TextLink
            label={t('auth.emailSignIn.forgotPassword')}
            onPress={() => router.push('/(auth)/forgot-password')}
          />
        </View>
      </View>
    </StackScreen>
  );
}
