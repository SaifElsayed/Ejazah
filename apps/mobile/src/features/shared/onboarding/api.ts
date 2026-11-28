// T051 (FR-124 to FR-127): the onboarding procedures of T048 as the screens call them.
// `onboarding.complete` creates the account in one call, not keyed (its token's `jti` is its single
// use); the Terms version is the one `platform.publicConfig` serves. The account is created in the
// default language of an anonymous call (`ar`), so a person onboarding in English sets it once the
// session exists (FR-131); a failure there leaves the account in Arabic and the screen in English,
// and the account tab sets it again on the next switch.
//
// A city chosen on the step is kept the same way: `complete` stamps no override, so without
// `account.setTimezone` the launch report would replace it with the device's zone (review of B10b,
// round 1, finding 1). The device's own zone is left to that report.
import type { OnboardingCompleteInput } from '@ijazah/contracts';
import { useMemo } from 'react';

import { getLocale } from '../../../i18n';
import { useApi } from '../../../lib/api';
import { setSession } from '../../../lib/session';
import { deviceTimeZone } from '../../../lib/time-zone';
import { clearDraft, type OnboardingDraft } from './draft';

/** A draft complete enough to create the account from. */
export type ReadyDraft = OnboardingDraft &
  Required<Pick<OnboardingDraft, 'role' | 'gender' | 'dateOfBirth'>> & {
    readonly timezone: string;
    /** R3 T189: set exactly when the step asked a minor for the guardian's tick and it is ticked. */
    readonly guardianAgreed?: true;
  };

/** `onboarding.complete`'s input from the draft, with only the fields its identity needs. */
export function completeInput(draft: ReadyDraft, termsVersion: string): OnboardingCompleteInput {
  return {
    onboardingToken: draft.onboardingToken,
    role: draft.role,
    displayName: draft.displayName.trim(),
    gender: draft.gender,
    dateOfBirth: draft.dateOfBirth,
    timezone: draft.timezone,
    termsVersion,
    ...(draft.identity === 'email' && draft.password !== undefined
      ? { password: draft.password }
      : {}),
    ...(draft.emailVerified ? {} : { email: draft.email.trim(), emailCode: draft.emailCode }),
    ...(draft.guardianAgreed === true ? { guardianAgreed: true } : {}),
  };
}

export function useOnboardingApi() {
  const { client, sessions } = useApi();
  return useMemo(
    () => ({
      async requestEmailCode(onboardingToken: string, email: string): Promise<void> {
        await client.api.onboarding.requestEmailCode.mutate({ onboardingToken, email });
      },

      async complete(draft: ReadyDraft): Promise<void> {
        const { termsVersion } = await client.publicConfig();
        const session = await client.api.onboarding.complete.mutate(
          completeInput(draft, termsVersion),
        );
        await sessions.write({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
        const language = getLocale();
        if (language !== 'ar') {
          await client.api.account.setLanguage.mutate({ language }).catch(() => undefined);
        }
        if (draft.timezone !== deviceTimeZone()) {
          await client.api.account.setTimezone
            .mutate({ timezone: draft.timezone })
            .catch(() => undefined);
        }
        clearDraft();
        // The guard lands the new account through `account.me`, as after any sign-in (T052).
        setSession({ kind: 'restoring' });
      },
    }),
    [client, sessions],
  );
}
