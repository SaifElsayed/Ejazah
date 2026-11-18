// T084 (FR-140, FR-141, ADR 0015 D1): what the student's and the teacher's deletion share. The typed
// word is either language's (`حذف`, or `delete` in any case, sent as the contract spells it). The
// proof is fresh and by the account's own method: Google or Apple through the provider's sheet, over
// a nonce `auth.providerNonce` mints, as sign-in does (a development build signs in as the API's
// stand-in, so it proves itself the same way); an email account by its password. Each attempt sends
// its own idempotency key (FR-106): a proof is single-use, so a new attempt is a new request. Once
// deleted, the device forgets the session as sign-out does; nothing is sent, since the deletion
// revoked every session, and the guard lands on the welcome screen. The providers' native modules
// load with this folder, which is why it is not part of `shared/account`'s entry: the screens that
// read that entry (the homes, the application, the payout) never load the providers.
//
// T080 of specs/004-sessions (FR-511; SRS FR-AUTH-14 as amended): the deletion refused for an
// ongoing enrollment (`CONFLICT` `active_enrollments`) is told apart here, and the support address
// the public configuration serves (FR-145) is written to from here, so the sheet only draws them.
//
// 005:T031 of specs/005-certification (FR-630): a teacher's deletion refused for an undecided ijazah
// request (`CONFLICT` `pending_ijazah_requests`) is told apart the same way, each cause its own text.
import type { DeleteAccountInput } from '@ijazah/contracts';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { setSession } from '../../../lib/session';
import { DEV_EMAIL, devIdentityToken, devSignInEnabled } from '../auth/dev-sign-in';
import { nativeIdentity } from '../auth/providers';

export type DeletionConfirmation = DeleteAccountInput['confirmation'];

/** How the person proves it is them: their provider's sheet, or the password they typed. */
export type DeletionProof =
  | { readonly kind: 'provider'; readonly provider: 'google' | 'apple' }
  | { readonly kind: 'password'; readonly password: string };

/** What an attempt came to; a refusal is thrown as the API's error. */
export type DeletionOutcome = 'deleted' | 'cancelled';

const ARABIC_WORD: DeletionConfirmation = 'حذف';
const LATIN_WORD: DeletionConfirmation = 'DELETE';

/** T080: whether a failed attempt is the refusal of an ongoing enrollment; it names no count. */
export function isOngoingRefusal(error: unknown): boolean {
  return deletionRefusalOf(error) === 'active_enrollments';
}

/** The causes a person's own deletion is refused by while a matter of theirs is open (T080, 005:T031). */
export type DeletionRefusal = 'active_enrollments' | 'pending_ijazah_requests';

const REFUSALS: readonly DeletionRefusal[] = ['active_enrollments', 'pending_ijazah_requests'];

/** The refusal a failed attempt is, by its cause, or null for any other failure; it names no count. */
export function deletionRefusalOf(error: unknown): DeletionRefusal | null {
  if (errorCodeOf(error) !== 'CONFLICT') return null;
  const cause = errorDetailsOf(error).find(({ path }) => path === 'cause')?.code;
  return REFUSALS.find((refusal) => refusal === cause) ?? null;
}

/** The contract's word for what the person typed, or null while it is not one. */
export function confirmationOf(typed: string): DeletionConfirmation | null {
  const word = typed.trim();
  if (word === ARABIC_WORD) return ARABIC_WORD;
  if (word.toUpperCase() === LATIN_WORD) return LATIN_WORD;
  return null;
}

export function useAccountDeletion() {
  const { client, sessions } = useApi();
  return useMemo(() => {
    const { api } = client;

    async function reauthOf(proof: DeletionProof): Promise<DeleteAccountInput['reauth'] | null> {
      if (proof.kind === 'password') return { kind: 'password', password: proof.password };
      const { nonce } = await api.auth.providerNonce.mutate({});
      const identity =
        proof.provider === 'google' && devSignInEnabled()
          ? { identityToken: devIdentityToken(nonce), email: DEV_EMAIL }
          : await nativeIdentity(proof.provider, nonce);
      if (identity === null) return null;
      return { kind: 'provider', identityToken: identity.identityToken, nonce };
    }

    return {
      async deleteAccount(
        confirmation: DeletionConfirmation,
        proof: DeletionProof,
      ): Promise<DeletionOutcome> {
        const reauth = await reauthOf(proof);
        if (reauth === null) return 'cancelled';
        await api.account.delete.mutate({
          confirmation,
          reauth,
          idempotencyKey: Crypto.randomUUID(),
        });
        await sessions.clear();
        setSession({ kind: 'signed-out' });
        return 'deleted';
      },

      /** T080: a mail to the support address the public configuration serves (FR-145). */
      async contactSupport(): Promise<void> {
        const { supportEmail } = await client.publicConfig();
        await Linking.openURL(`mailto:${supportEmail}`);
      },
    };
  }, [client, sessions]);
}
