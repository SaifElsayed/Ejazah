// T084 (FR-140, ADR 0015 D1 steps 2 and 3): the last confirmation both deletion screens open
// (DeleteAccountSheet and DeleteAccountTeacherSheet): the danger tile, the question, the sentence,
// and one button that proves the person by their sign-in method and deletes. A Google or Apple
// account goes through the provider's own sheet (the board's «تأكيد بجوجل وحذف الحساب»; Apple's and
// the password's buttons are catalogued beside it); an email account types its password here first.
// A closed provider sheet changes nothing; a refused proof is said in place under the field or as a
// banner, and the person tries again with a new attempt.
import type { SignInMethod } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Field,
  IconTile,
  InputGroup,
  Sheet,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type DeletionConfirmation, type DeletionProof, useAccountDeletion } from '../api';

export interface DeletionSheetCopy {
  readonly title: string;
  readonly text: string;
  readonly confirm: Readonly<Record<SignInMethod, string>>;
  readonly cancel: string;
}

/** The API's answer to a proof that is not the caller's own (the password or the provider token). */
const PROOF_REFUSED = 'SIGN_IN_FAILED';

export function DeletionSheet({
  copy,
  method,
  confirmation,
  onClose,
}: {
  readonly copy: DeletionSheetCopy;
  readonly method: SignInMethod;
  readonly confirmation: DeletionConfirmation;
  readonly onClose: () => void;
}) {
  const t = useT();
  const deletion = useAccountDeletion();
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'proof' | 'other' | null>(null);

  const proof: DeletionProof =
    method === 'email' ? { kind: 'password', password } : { kind: 'provider', provider: method };

  async function confirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await deletion.deleteAccount(confirmation, proof);
    } catch (caught: unknown) {
      setError(errorCodeOf(caught) === PROOF_REFUSED ? 'proof' : 'other');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <View style={{ gap: tokens.space['3'] }}>
        <IconTile icon={{ name: 'trash' }} tone="danger" size="lg" />
        <Text variant="title-3">{copy.title}</Text>
        <Text tone="muted">{copy.text}</Text>
      </View>
      {error === 'other' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
      {error === 'proof' && method !== 'email' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('account.delete.sheet.providerFailed')}
        </Banner>
      ) : null}
      {method === 'email' ? (
        <Field
          label={t('auth.field.password')}
          {...(error === 'proof' ? { error: t('account.delete.sheet.passwordFailed') } : {})}
        >
          <InputGroup
            value={password}
            onChangeText={setPassword}
            secure={!shown}
            ltr
            error={error === 'proof'}
            trailing={{
              icon: { name: shown ? 'eye-off' : 'eye' },
              accessibilityLabel: t('auth.emailSignIn.a11y.showPassword'),
              onPress: () => setShown((value) => !value),
            }}
          />
        </Field>
      ) : null}
      <View style={{ gap: tokens.space['2'] }}>
        <Button
          label={copy.confirm[method]}
          variant="danger"
          layout="block"
          loading={busy}
          disabled={busy || (method === 'email' && password === '')}
          onPress={() => void confirm()}
        />
        <Button
          label={copy.cancel}
          variant="ghost"
          layout="block"
          disabled={busy}
          onPress={onClose}
        />
      </View>
    </Sheet>
  );
}
