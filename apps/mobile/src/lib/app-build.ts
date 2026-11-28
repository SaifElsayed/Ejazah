// R3 T184 (SRS DEC-99, DEC-109; the note under T184, Q-2 (a′)): the running build's number, the
// minimum-version gate's side on the phone. It is read from the binary with `expo-application`'s
// `nativeBuildVersion` (Play's version code, kept in `apps/mobile/app.json`), never from the app
// config, which an over-the-air update would replace. A whole number of one to ten digits, as the
// server reads `x-app-build` (`apps/api/src/platform/guards/app-build.guard.ts`), is the number;
// anything else (none under Expo Go or on the web, empty, a decimal, letters) is none, and then the
// phone sends no header at all, which the server admits.
import { nativeBuildVersion } from 'expo-application';

/** The header the build number travels in on every call (T184). */
export const APP_BUILD_HEADER = 'x-app-build';

/** The API's code for a build below the floor, answered 426 (T184). */
export const UPDATE_REQUIRED = 'UPDATE_REQUIRED';

/** One to ten digits: a version code, at most 2,100,000,000 on Play. */
const BUILD_NUMBER = /^\d{1,10}$/;

/** The running build's version code, or null when the binary carries none that is a number. */
export function appBuild(): number | null {
  const version = nativeBuildVersion;
  if (version === null || !BUILD_NUMBER.test(version)) return null;
  return Number(version);
}

/** `headers` with `x-app-build` set to `build` when it is a number; none at all otherwise. */
export function withAppBuild(headers: HeadersInit | undefined, build: number | null): Headers {
  const stamped = new Headers(headers);
  if (build !== null) stamped.set(APP_BUILD_HEADER, String(build));
  return stamped;
}
