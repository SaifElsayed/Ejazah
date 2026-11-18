// T020 of specs/005-certification (FR-623; research.md R-405; the note under T020, Q-T2 (a)): the
// phone's push interface. `ask()` shows the system's own permission prompt (the system answers
// without a prompt once the person has decided) and says whether pushes are allowed; `token()` is
// the device's push token, null while there is none. `expo-notifications` is not installed in B48,
// so the one binding is the stand-in: it asks nothing and yields no token, and no token is ever
// registered. The package's install, with the FCM/EAS set-up and a new build, binds the real one
// here, on the owner's word.
export interface PushBinding {
  /** The system's permission prompt; true once pushes are allowed. */
  ask(): Promise<boolean>;
  /** The device's push token, or null when it has none. */
  token(): Promise<string | null>;
}

/** The stand-in: nothing to ask on this build, and no token. */
export const standInPush: PushBinding = {
  ask: async () => false,
  token: async () => null,
};

/** The binding the screens use; the stand-in until the package exists (Q-T2 (a)). */
export const pushBinding: PushBinding = standInPush;
