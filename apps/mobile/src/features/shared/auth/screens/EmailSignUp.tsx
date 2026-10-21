// T050 (FR-AUTH-1, ADR 0012 D1, FR-128): a new account by email. The address, a password of the
// contract's length (no composition rule; the breached check is the server's at `complete`) and
// its confirmation; the code is sent and the password stays on the device until the onboarding
// sends it with `onboarding.complete`. The answer is the same for every address: a conflict is told
// only after the code proves the mailbox (app-surface.md).
import { emailAddress, PASSWORD_MIN_LENGTH } from '@ijazah/contracts';
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
  Text,
  TextLink,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { BackBar, StackScreen } from '../../screen';
import { useAuthApi } from '../api';
import { setPendingEmail } from '../pending';

type Problem = { readonly field: 'email' | 'password' | 'confirm'; readonly key: MessageKey };

/** What is wrong with the form before anything is sent, if anything. */
export function signUpProblem(email: string, password: string, confirm: string): Problem | null {
  if (!emailAddress.safeParse(email.trim()).success) {
    return { field: 'email', key: 'auth.field.emailInvalid' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { field: 'password', key: 'auth.password.minLength' };
  }
  if (password !== confirm) return { field: 'confirm', key: 'auth.password.mismatch' };
  return null;
}

export function EmailSignUp() {
  const t = useT();
  const auth = useAuthApi();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setFailed(false);
    const found = signUpProblem(email, password, confirm);
    setProblem(found);
    if (found !== null) return;
    setBusy(true);
    try {
      await auth.requestSignUpCode(email.trim());
      setPendingEmail(email.trim(), password);
      router.push('/(auth)/otp');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
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
            label={t('auth.emailSignUp.sendCode')}
            layout="block"
            loading={busy}
            disabled={busy}
            onPress={() => void submit()}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: tokens.space['1'] }}>
            <Text variant="callout" tone="muted">
              {t('auth.emailSignUp.haveAccount')}
            </Text>
            <TextLink
              label={t('auth.emailSignUp.signIn')}
              variant="strong"
              onPress={() => router.back()}
            />
          </View>
        </ActionBar>
      }
    >
      <PageIntro title={t('auth.emailSignUp.title')} />
      {failed ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
      <Field label={t('auth.field.email')} {...errorOf('email')}>
        <Input value={email} onChangeText={setEmail} keyboard="email" ltr />
      </Field>
      <Field
        label={t('auth.field.password')}
        {...(problem?.field === 'password' ? {} : { hint: t('auth.password.minLength') })}
        {...errorOf('password')}
      >
        <Input value={password} onChangeText={setPassword} secure ltr />
      </Field>
      <Field label={t('auth.field.confirmPassword')} {...errorOf('confirm')}>
        <Input value={confirm} onChangeText={setConfirm} secure ltr />
      </Field>
    </StackScreen>
  );
}
