// T084 (FR-140, ADR 0015 D1 steps 2 and 3): the last confirmation both deletion screens open
// (DeleteAccountSheet and DeleteAccountTeacherSheet): the danger tile, the question, the sentence,
// and one button that proves the person by their sign-in method and deletes. A Google or Apple
// account goes through the provider's own sheet (the board's «تأكيد بجوجل وحذف الحساب»; Apple's and
// the password's buttons are catalogued beside it); an email account types its password here first.
// A closed provider sheet changes nothing; a refused proof is said in place under the field or as a
// banner, and the person tries again with a new attempt.
//
// T080 of specs/004-sessions (FR-511; SRS FR-AUTH-14 as amended): a deletion refused for an ongoing
// enrollment says the line's sentence, naming no count, and offers «تواصل مع الدعم» (a mail to the
// support address) in place of the confirm button; the password field goes with the button.
// 005:T031 of specs/005-certification (FR-630): a teacher's deletion refused for an undecided ijazah
// request says that cause's own sentence the same way.
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
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import {
  type DeletionConfirmation,
  type DeletionProof,
  type DeletionRefusal,
  deletionRefusalOf,
  useAccountDeletion,
} from '../api';

export interface DeletionSheetCopy {
  readonly title: string;
  readonly text: string;
  readonly confirm: Readonly<Record<SignInMethod, string>>;
  readonly cancel: string;
}

/** The API's answer to a proof that is not the caller's own (the password or the provider token). */
const PROOF_REFUSED = 'SIGN_IN_FAILED';

/** Each refusal's sentence (T080, 005:T031). */
const REFUSAL_TEXT = {
  active_enrollments: 'account.delete.refused.activeEnrollments',
  pending_ijazah_requests: 'account.delete.refused.pendingIjazahRequests',
} as const satisfies Readonly<Record<DeletionRefusal, string>>;

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
  const [error, setError] = useState<'proof' | ErrorMessage | null>(null);
  const [refusal, setRefusal] = useState<DeletionRefusal | null>(null);
  const [supportFailure, setSupportFailure] = useState<ErrorMessage | null>(null);
  const ongoing = refusal !== null;

  const proof: DeletionProof =
    method === 'email' ? { kind: 'password', password } : { kind: 'provider', provider: method };

  async function confirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await deletion.deleteAccount(confirmation, proof);
    } catch (caught: unknown) {
      const refused = deletionRefusalOf(caught);
      if (refused !== null) setRefusal(refused);
      else {
        setError(
          errorCodeOf(caught) === PROOF_REFUSED
            ? 'proof'
            : genericErrorKey(caught, 'common.state.actionError'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function writeToSupport(): Promise<void> {
    setSupportFailure(null);
    try {
      await deletion.contactSupport();
    } catch (caught: unknown) {
      setSupportFailure(genericErrorKey(caught, 'common.state.actionError'));
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <View style={{ gap: tokens.space['3'] }}>
        <IconTile icon={{ name: 'trash' }} tone="danger" size="lg" />
        <Text variant="title-3">{copy.title}</Text>
        <Text tone="muted">{copy.text}</Text>
      </View>
      {refusal === null ? null : (
        <Banner icon={{ name: 'triangle-alert' }} tone="warning">
          {t(REFUSAL_TEXT[refusal])}
        </Banner>
      )}
      {supportFailure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(supportFailure.key, supportFailure.values)}
        </Banner>
      )}
      {error !== null && error !== 'proof' && !ongoing ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(error.key, error.values)}
        </Banner>
      ) : null}
      {error === 'proof' && method !== 'email' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('account.delete.sheet.providerFailed')}
        </Banner>
      ) : null}
      {method === 'email' && !ongoing ? (
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
        {ongoing ? (
          <Button
            label={t('account.restricted.contactSupport')}
            icon={{ name: 'mail' }}
            layout="block"
            onPress={() => void writeToSupport()}
          />
        ) : (
          <Button
            label={copy.confirm[method]}
            variant="danger"
            layout="block"
            loading={busy}
            disabled={busy || (method === 'email' && password === '')}
            onPress={() => void confirm()}
          />
        )}
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
