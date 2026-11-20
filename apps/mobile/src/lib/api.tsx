// T034: the one API client of the app, created once at the root and read through `useApi()`
// (R-MOBILE-11). Its endpoint is the build's `EXPO_PUBLIC_API_URL` (the API's origin; the user
// surface is mounted at `/trpc`); a build without it stops at launch rather than calling nowhere.
import { createContext, type ReactNode, useContext, useState } from 'react';

import { type ApiClient, createApiClient } from './client';
import { setSession } from './session';
import { createSessionStore, type SessionStore } from './storage';

const ApiContext = createContext<{
  readonly client: ApiClient;
  readonly sessions: SessionStore;
} | null>(null);

/** The API's origin from the build's environment (its pages too: the Terms, T051). */
export function apiOrigin(origin: string | undefined = process.env['EXPO_PUBLIC_API_URL']): string {
  if (origin === undefined || origin === '') {
    throw new Error('EXPO_PUBLIC_API_URL is not set: the app has no API to call');
  }
  return origin.replace(/\/+$/, '');
}

/** The user surface's endpoint from the build's environment. */
export function apiUrl(origin: string | undefined = process.env['EXPO_PUBLIC_API_URL']): string {
  return `${apiOrigin(origin)}/trpc`;
}

/**
 * `onSignedOut` (002:T148, B50): what else ends with a refused refresh; the root passes the
 * sign-in providers' sign-out, so the phone leaves Google as the app's own sign-out does.
 */
export function ApiProvider({
  children,
  onSignedOut,
}: {
  readonly children: ReactNode;
  readonly onSignedOut?: () => void;
}) {
  const [value] = useState(() => {
    const sessions = createSessionStore();
    const client = createApiClient({
      url: apiUrl(),
      documentsUploadUrl: `${apiOrigin()}/uploads/documents`,
      photosUploadUrl: `${apiOrigin()}/uploads/photos`,
      chatUploadUrl: `${apiOrigin()}/uploads/chat`,
      // 005:T019 (FR-601): the teacher's signature image.
      signatureUploadUrl: `${apiOrigin()}/uploads/signature`,
      sessions,
      // A refused refresh has already cleared the tokens; the guard lands the person on welcome.
      onSignedOut: () => {
        onSignedOut?.();
        setSession({ kind: 'signed-out' });
      },
    });
    return { client, sessions };
  });
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/** The API client and the session store. */
export function useApi(): { readonly client: ApiClient; readonly sessions: SessionStore } {
  const value = useContext(ApiContext);
  if (value === null) throw new Error('useApi outside ApiProvider');
  return value;
}
