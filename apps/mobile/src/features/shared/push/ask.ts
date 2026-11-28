// T020 of specs/005-certification (FR-623; research.md R-405, «asked the first time a push could
// matter»): the permission asked, and the token registered. A screen that needs pushes (the first
// confirmed booking, the enrollment's) asks once it is drawn, never the sign-in. Pushes allowed and
// a token held, `account.pushToken.register` takes it with the device's platform (an upsert by the
// token's hash on the server). Best effort, as the device's time zone is reported (`app/_layout.tsx`):
// a failed registration changes nothing on the screen and is tried again the next time one opens.
// R3 (T020's follow-ups; Q-4′ (b)): the teacher's home asks too, and the sign-out removes the token.
import type {
  DevicePlatform,
  PushTokenRegisterInput,
  PushTokenRemoveInput,
} from '@ijazah/contracts';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useApi } from '../../../lib/api';
import { forgetPushToken, heldPushToken, type PushBinding, pushBinding } from './binding';

/** The contract's platform for the system's name, or null for one that takes no push. */
export function devicePlatformOf(os: string): DevicePlatform | null {
  if (os === 'ios' || os === 'android') return os;
  return null;
}

/** Asks, then registers the token when pushes are allowed and one exists; true once registered. */
export async function askAndRegister(
  binding: PushBinding,
  platform: DevicePlatform | null,
  register: (input: PushTokenRegisterInput) => Promise<unknown>,
): Promise<boolean> {
  if (platform === null) return false;
  if (!(await binding.ask())) return false;
  const token = await binding.token();
  if (token === null) return false;
  await register({ token, platform });
  return true;
}

/**
 * The sign-out's half (R3; T020's follow-up Q-T3; FR-623): the token held (read by this process,
 * or kept from an earlier one), removed from the caller's account while the session still holds,
 * then forgotten. Best effort: a failed removal never holds the sign-out, even one that throws
 * before it returns a promise (PR #163 r1 Major 1), and with no token held nothing is sent.
 */
export async function removeHeldPushToken(
  remove: (input: PushTokenRemoveInput) => Promise<unknown>,
): Promise<void> {
  const token = await heldPushToken();
  if (token === null) return;
  await Promise.resolve()
    .then(() => remove({ token }))
    .catch(() => undefined);
  await forgetPushToken();
}

/** Asks for pushes once `when` holds, once per screen opened. */
export function useAskForPush(when: boolean): void {
  const { client } = useApi();
  const asked = useRef(false);
  useEffect(() => {
    if (!when || asked.current) return;
    asked.current = true;
    void askAndRegister(pushBinding, devicePlatformOf(Platform.OS), (input) =>
      client.api.account.pushToken.register.mutate(input),
    ).catch(() => undefined);
  }, [when, client]);
}
