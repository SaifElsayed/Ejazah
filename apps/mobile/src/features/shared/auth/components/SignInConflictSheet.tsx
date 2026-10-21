// T050 (FR-123, ADR 0012 D3): the sheet over the screen whose sign-in found the address already
// used by another method. Its body names the address and that method, and its primary button is the
// way in by that method; nothing links the two accounts. Drawn for email and password; the Google and
// Apple bodies are the same sheet with their own body and button (screens.md, SignInConflict).
import type { SignInMethod } from '@ijazah/contracts';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, IconTile, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';

const BODY: Readonly<Record<SignInMethod, MessageKey>> = {
  email: 'auth.signInConflict.bodyEmailPassword',
  google: 'auth.signInConflict.bodyGoogle',
  apple: 'auth.signInConflict.bodyApple',
};

const PRIMARY: Readonly<Record<SignInMethod, MessageKey>> = {
  email: 'auth.signInConflict.signInEmailPassword',
  google: 'auth.signInConflict.signInGoogle',
  apple: 'auth.signInConflict.signInApple',
};

export interface SignInConflict {
  readonly method: SignInMethod;
  readonly email: string;
}

export function SignInConflictSheet({
  conflict,
  onClose,
  onProvider,
}: {
  readonly conflict: SignInConflict | null;
  readonly onClose: () => void;
  /** Signs in with the provider the address uses. */
  readonly onProvider: (provider: 'google' | 'apple') => void;
}) {
  const t = useT();
  if (conflict === null) return null;
  const { method, email } = conflict;
  const primary = () => {
    onClose();
    if (method === 'email') router.push('/(auth)/email-sign-in');
    else onProvider(method);
  };
  return (
    <Sheet open onClose={onClose}>
      <View style={{ alignItems: 'center', gap: tokens.space['3'] }}>
        <IconTile icon={{ name: 'mail' }} tone="warning" size="lg" round />
        <Text variant="title-3" align="center">
          {t('auth.signInConflict.title')}
        </Text>
        <Text tone="muted" align="center">
          {t(BODY[method], { email })}
        </Text>
      </View>
      <View style={{ gap: tokens.space['2'] }}>
        <Button
          label={t(PRIMARY[method])}
          layout="block"
          {...(method === 'email'
            ? {}
            : { variant: method, icon: { name: method, fill: 'solid' } })}
          onPress={primary}
        />
        <Button label={t('common.action.back')} variant="ghost" layout="block" onPress={onClose} />
      </View>
    </Sheet>
  );
}
