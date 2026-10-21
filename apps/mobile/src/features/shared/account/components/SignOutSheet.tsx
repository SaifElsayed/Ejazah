// T052 (FR-AUTH-7): the sign-out confirmation, opened from either account tab (and from the
// restricted screen, T074). Its sentence tells how to come back: the same Google or Apple account,
// or the email and password (the board draws Google's; the other two are catalogued beside it).
import type { SignInMethod } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useAccountActions } from '../hooks';

const TEXT: Readonly<Record<SignInMethod, MessageKey>> = {
  google: 'account.signOutSheet.text',
  apple: 'account.signOutSheet.textApple',
  email: 'account.signOutSheet.textEmail',
};

export function SignOutSheet({
  open,
  method,
  onClose,
}: {
  readonly open: boolean;
  readonly method: SignInMethod;
  readonly onClose: () => void;
}) {
  const t = useT();
  const actions = useAccountActions();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await actions.signOut();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('account.signOutSheet.title')}>
      <Text tone="muted">{t(TEXT[method])}</Text>
      <View style={{ gap: tokens.space['2'] }}>
        <Button
          label={t('account.signOutSheet.confirm')}
          variant="danger"
          icon={{ name: 'log-out' }}
          layout="block"
          loading={busy}
          disabled={busy}
          onPress={() => void signOut()}
        />
        <Button
          label={t('account.signOutSheet.cancel')}
          variant="ghost"
          layout="block"
          disabled={busy}
          onPress={onClose}
        />
      </View>
    </Sheet>
  );
}
