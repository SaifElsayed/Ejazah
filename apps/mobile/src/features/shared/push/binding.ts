// T020 of specs/005-certification (FR-623; research.md R-405; the note under T020, Q-T2 (a)): the
// phone's push interface. `ask()` shows the system's own permission prompt (the system answers
// without a prompt once the person has decided) and says whether pushes are allowed; `token()` is
// the device's push token, null while there is none. B48 built it on a stand-in that asks nothing
// and yields no token; the stand-in stays for the specs.
//
// R3 (T020's note; 002:T182's note, (4); Q-4 (a)): the screens' binding is `expo-notifications`'.
// `ask()` makes Android's default channel first, named in the person's language (Android 13 shows
// the permission prompt only once the app has a channel; Expo's push service posts a message that
// names no channel to `default`), then answers with the system's permission. `token()` is the Expo
// push token of the EAS project `app.json` names, and null on any failure (no network, or a build
// without the Firebase file, which has no token), so a screen that asks never sees an error. The
// token read is held for this process, so the sign-out can remove it (`ask.ts`). The package is
// loaded on the first ask or read, never on import: the account's entry imports this folder for the
// sign-out, and the screens that read that entry load no native module until they need it
// (`shared/account/hooks.ts`, `signOutOfProviders`).
import app from '../../../../app.json';
import { t } from '../../../i18n';

export interface PushBinding {
  /** The system's permission prompt; true once pushes are allowed. */
  ask(): Promise<boolean>;
  /** The device's push token, or null when it has none. */
  token(): Promise<string | null>;
}

/** Android's channel the pushes arrive on. */
const DEFAULT_CHANNEL = 'default';

/** The stand-in: nothing to ask on this build, and no token. */
export const standInPush: PushBinding = {
  ask: async () => false,
  token: async () => null,
};

let held: string | null = null;

/** An inline require, as `signOutOfProviders` loads the providers: Metro evaluates it only here. */
function notifications(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
}

/** `expo-notifications`' binding (R3, Q-4 (a)). */
export const expoPush: PushBinding = {
  async ask() {
    const Notifications = notifications();
    await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL, {
      name: t('notifications.channel.default'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    return (await Notifications.requestPermissionsAsync()).granted;
  },
  async token() {
    try {
      const { data } = await notifications().getExpoPushTokenAsync({
        projectId: app.expo.extra.eas.projectId,
      });
      held = data;
      return data;
    } catch {
      return null;
    }
  },
};

/** The token this process last read, which the sign-out removes; null when none was read. */
export function heldPushToken(): string | null {
  return held;
}

/** The binding the screens use. */
export const pushBinding: PushBinding = expoPush;
