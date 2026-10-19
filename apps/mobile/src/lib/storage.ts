// T033: the only place sensitive values are stored on the device (R-MOBILE-10). The session's two
// tokens are written to the platform's secure store (Keychain, Keystore) through
// `expo-secure-store`, readable after the device's first unlock and never moved to another device
// by a backup or a restore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`): a token carried to a new phone
// is a session nobody signed in to there. Each token
// is its own item, so neither nears the 2 KB a Keychain item may hold on iOS.
import * as SecureStore from 'expo-secure-store';

/** The session's two tokens (`auth.refresh`'s output, contracts/auth.ts). */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** Where the session lives. */
export interface SessionStore {
  read(): Promise<SessionTokens | null>;
  write(tokens: SessionTokens): Promise<void>;
  clear(): Promise<void>;
}

/** The part of `expo-secure-store` the session store uses. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const ACCESS_KEY = 'ijazah.session.access';
const REFRESH_KEY = 'ijazah.session.refresh';

const writeOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The session store over the device's secure store (`store` is injectable for tests). */
export function createSessionStore(store: SecureStoreLike = SecureStore): SessionStore {
  // One operation at a time: a read never runs between the two writes of a sign-in, where it
  // would see half a session and remove it (review of B6, finding 2).
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };
  const clearNow = async () => {
    await Promise.all([store.deleteItemAsync(ACCESS_KEY), store.deleteItemAsync(REFRESH_KEY)]);
  };
  return {
    read: () =>
      serial(async () => {
        const [accessToken, refreshToken] = await Promise.all([
          store.getItemAsync(ACCESS_KEY),
          store.getItemAsync(REFRESH_KEY),
        ]);
        if (accessToken !== null && refreshToken !== null) return { accessToken, refreshToken };
        // Half a session is no session: a write the app did not finish (it was killed between them).
        if (accessToken !== null || refreshToken !== null) await clearNow();
        return null;
      }),
    write: (tokens) =>
      serial(async () => {
        await store.setItemAsync(ACCESS_KEY, tokens.accessToken, writeOptions);
        await store.setItemAsync(REFRESH_KEY, tokens.refreshToken, writeOptions);
      }),
    clear: () => serial(clearNow),
  };
}
