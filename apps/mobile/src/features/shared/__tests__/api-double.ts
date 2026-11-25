// B10b: the API as the screens' specs see it (B11b adds the teacher's application and credentials,
// the subjects, and the documents upload; B15 the payout account; B16 the profile editor, its photo
// upload and the deletion). `useApi()` is replaced by a client whose procedures
// are mocks answering what each case says, and a session store in memory; an API refusal is the
// tRPC client error the real client raises, carrying the code and details the screens read.
import type { PublicConfig } from '@ijazah/contracts';
import { jest } from '@jest/globals';
import { TRPCClientError } from '@trpc/client';

import type { SessionStore, SessionTokens } from '../../../lib/storage';

export type Procedure = jest.Mock<(input?: unknown) => Promise<unknown>>;

const procedure = (): Procedure => jest.fn(async () => undefined);

/** A read refused NOT_FOUND unless a case plants an answer (006:T019). */
const notFound = (): Procedure =>
  jest.fn(async (): Promise<unknown> => {
    throw apiError('NOT_FOUND');
  });

/** A subscription's mock: the stream it opens never says anything (T065). */
export type Subscription = jest.Mock<
  (input: unknown, handlers: unknown) => { unsubscribe: jest.Mock<() => void> }
>;

const subscription = (): Subscription => jest.fn(() => ({ unsubscribe: jest.fn<() => void>() }));

/** Every procedure the B10b, B11b, B15 and B16 screens call, each a mock. */
export function fakeProcedures() {
  return {
    auth: {
      providerNonce: { mutate: procedure() },
      signInWithProvider: { mutate: procedure() },
      signOut: { mutate: procedure() },
      email: {
        requestSignUpCode: { mutate: procedure() },
        verifySignUpCode: { mutate: procedure() },
        signIn: { mutate: procedure() },
        requestPasswordReset: { mutate: procedure() },
        resetPassword: { mutate: procedure() },
      },
    },
    onboarding: {
      requestEmailCode: { mutate: procedure() },
      complete: { mutate: procedure() },
    },
    account: {
      me: { query: procedure() },
      setLanguage: { mutate: procedure() },
      setTimezone: { mutate: procedure() },
      reportDeviceTimezone: { mutate: procedure() },
      updateProfile: { mutate: procedure() },
      delete: { mutate: procedure() },
      identityVerification: {
        get: { query: procedure() },
        submit: { mutate: procedure() },
      },
    },
    catalog: { subjects: { list: { query: procedure() } } },
    // B28 (T029, T030): the student's discovery.
    discovery: {
      browse: { query: procedure() },
      filters: { query: procedure() },
      teacher: { query: procedure() },
    },
    // B30: the booking sheet (T044); Checkout, `CheckoutPrevious` and `CheckoutExpired` (T045),
    // and the outcomes (T046).
    booking: { slots: { query: procedure() } },
    checkout: {
      hold: { mutate: procedure() },
      current: { query: procedure() },
      pay: { mutate: procedure() },
      continue: { query: procedure() },
      status: { query: procedure() },
      retry: { mutate: procedure() },
    },
    // B31 (T050): the student's enrollments and home.
    enrollments: {
      list: { query: procedure() },
      get: { query: procedure() },
    },
    // 006:T019 (B-P4 lane a): the programme. `get` answers NOT_FOUND, the server's answer for an
    // enrollment that is not a programme, unless a case plants one.
    programme: {
      get: { query: notFound() },
      pay: { mutate: procedure() },
      renew: { mutate: procedure() },
      autoRenewOff: { mutate: procedure() },
      cancel: { mutate: procedure() },
      // 006:T020 (B-P4 lane b): the teacher's offer and stop request.
      offer: { mutate: procedure() },
      request: { mutate: procedure() },
    },
    teacher: {
      application: {
        get: { query: procedure() },
        submit: { mutate: procedure() },
        resubmit: { mutate: procedure() },
        reapply: { mutate: procedure() },
        markApprovedShown: { mutate: procedure() },
      },
      credentials: {
        list: { query: procedure() },
        add: { mutate: procedure() },
        replaceDocument: { mutate: procedure() },
        documentLink: { query: procedure() },
      },
      payout: {
        get: { query: procedure() },
        register: { mutate: procedure() },
      },
      // B26 (T023): the public profile.
      profile: {
        get: { query: procedure() },
        update: { mutate: procedure() },
      },
      // B26 (T021): the teacher's packages.
      packages: {
        list: { query: procedure() },
        create: { mutate: procedure() },
        update: { mutate: procedure() },
        // 003:T113: the editor's average-price hint.
        averagePrice: { query: procedure() },
      },
      // B26 (T022): the teacher's availability.
      slots: {
        list: { query: procedure() },
        create: { mutate: procedure() },
        update: { mutate: procedure() },
      },
      // B31 (T051): the teacher's students and day.
      students: {
        list: { query: procedure() },
        get: { query: procedure() },
      },
      today: { query: procedure() },
    },
    // B40a (T065): the live channel the root opens while signed in; a stream that never says anything.
    live: {
      events: { subscribe: subscription() },
    },
  };
}

export type FakeProcedures = ReturnType<typeof fakeProcedures>;

/** The session store in memory, with what it holds. */
export function memorySessions(initial: SessionTokens | null = null) {
  let current = initial;
  const store: SessionStore = {
    read: async () => current,
    write: async (tokens) => {
      current = tokens;
    },
    clear: async () => {
      current = null;
    },
  };
  return { store, current: () => current };
}

export interface FakeApi {
  readonly api: FakeProcedures;
  readonly sessions: ReturnType<typeof memorySessions>;
  /** What `useApi()` returns. */
  readonly value: {
    readonly client: {
      readonly api: FakeProcedures;
      readonly publicConfig: jest.Mock<() => Promise<PublicConfig>>;
      /** The documents upload: a fresh document id for each file unless a case says otherwise. */
      readonly uploadDocument: jest.Mock<
        (kind: 'identity' | 'credential', file: { uri: string; name: string }) => Promise<string>
      >;
      /** The photo upload: a signed link to the new photo unless a case says otherwise (B16). */
      readonly uploadPhoto: jest.Mock<
        (file: { uri: string; name: string; mimeType: string }) => Promise<string>
      >;
    };
    readonly sessions: SessionStore;
  };
}

/** `platform.publicConfig`'s checkout numbers at their seeded defaults (B30, T046; FR-383). */
export const CHECKOUT_POLLING: PublicConfig['checkout'] = {
  confirmationTimeoutSeconds: 15,
  processingPollSeconds: 2,
  confirmingPollSeconds: 30,
  confirmingPollWindowMinutes: 10,
};

/** What `useApi()` answers in a spec. */
export function fakeApi(termsVersion = '2026-10'): FakeApi {
  const api = fakeProcedures();
  const sessions = memorySessions();
  const publicConfig = jest.fn(async (): Promise<PublicConfig> => ({
    supportEmail: 'support@ijazah.test',
    termsVersion,
    checkout: CHECKOUT_POLLING,
    teacherSharePercent: 70,
    paymentMode: 'test',
    // B-P4 round 2 (Q-B1 (a); rule d): the programme's switch, off as seeded.
    programmeEnabled: false,
  }));
  let uploaded = 0;
  const uploadDocument = jest.fn(
    async (_kind: 'identity' | 'credential', _file: { uri: string; name: string }) => {
      uploaded += 1;
      return `0193a6f0-0000-7000-8000-${String(uploaded).padStart(12, '0')}`;
    },
  );
  const uploadPhoto = jest.fn(
    async (_file: { uri: string; name: string; mimeType: string }) =>
      'https://files.ijazah.test/photos/new.jpg?signature=1',
  );
  return {
    api,
    sessions,
    value: { client: { api, publicConfig, uploadDocument, uploadPhoto }, sessions: sessions.store },
  };
}

/** The error the client raises for an API refusal of `code`. */
export function apiError(
  code: string,
  details: readonly { path: string; code: string }[] = [],
): TRPCClientError<never> {
  return new TRPCClientError('refused', {
    meta: { responseJSON: { error: { code, message: 'refused', details } } },
  });
}

export const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };
