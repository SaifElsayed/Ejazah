// T020 of specs/005-certification (FR-623; research.md R-405; the note under T020, Q-T2 (a)): the push
// permission asked where a push first matters, in Arabic and English: after a confirmed booking
// (`PaymentSuccess`) and on the enrollment's screen, never at sign-in. With a binding that yields a
// token, `account.pushToken.register` takes it once per screen opened; with the stand-in, the one
// binding of this build, nothing is ever registered.
import type {
  CheckoutStatusOutput,
  EnrollmentsGetOutput,
  ListedSession,
  MeOutput,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { renderIn } from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { getSession, setSession } from '../../../lib/session';
import { fakeApi, tokens } from '../../shared/__tests__/api-double';
import { EmailSignIn } from '../../shared/auth';
import type { PushBinding } from '../../shared/push';
import { PaymentSuccess } from '../checkout';
import { EnrollmentDetail } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({
    id: '0193a6f0-0000-7000-8000-0000000000e1',
    enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1',
  }),
}));

// The sign-in's native providers are not in the test run (as `shared/auth/auth.spec.tsx` mocks them).
jest.mock('../../shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));

const TOKEN = 'ExponentPushToken[device-1]';
const mockAsk = jest.fn(async () => true);
const mockToken = jest.fn(async (): Promise<string | null> => TOKEN);
let mockUseStandIn = false;
/** The bound binding: a fake that yields a token, or the build's own stand-in. */
jest.mock('../../shared/push/binding', () => {
  const actual = jest.requireActual<typeof import('../../shared/push/binding')>(
    '../../shared/push/binding',
  );
  const bound: PushBinding = {
    ask: () => (mockUseStandIn ? actual.standInPush.ask() : mockAsk()),
    token: () => (mockUseStandIn ? actual.standInPush.token() : mockToken()),
  };
  return { ...actual, pushBinding: bound };
});

const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const me = {
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  timezone: CAIRO,
} as MeOutput;

const first: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-26',
  startTimeLocal: '20:00',
  timezone: CAIRO,
  startsAt: '2026-11-26T18:00:00.000Z',
  endsAt: '2026-11-26T18:45:00.000Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
};

const enrollment: EnrollmentsGetOutput = {
  enrollmentId: ENROLLMENT_ID,
  teacher: {
    teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
    displayName: TEACHER,
    displayNameOrNull: TEACHER,
    deleted: false,
  },
  summary: { subject: QURAN, track: 'recitation', sessionCount: 1, sessionDurationMinutes: 45 },
  status: 'confirmed',
  paused: false,
  next: first,
  last: first,
  upcoming: 1,
  completed: 0,
  remaining: 1,
  sessions: [first],
  complaintOpen: false,
  ijazahRequest: null,
};

const confirmed: CheckoutStatusOutput = {
  status: 'confirmed',
  lastOrder: { status: 'paid', reference: 'IJZ-7Q4K2M' },
  summary: {
    teacher: { teacherId: '0193a6f0-0000-7000-8000-0000000000d1', displayName: TEACHER },
    subject: QURAN,
    track: 'recitation',
    sessionCount: 1,
    sessionDurationMinutes: 45,
    price_piasters: 60_000,
  },
  sessions: [
    {
      sequenceNumber: 1,
      localDate: first.localDate,
      startTimeLocal: first.startTimeLocal,
      timezone: CAIRO,
      startsAt: first.startsAt,
      endsAt: first.endsAt,
    },
  ],
};

const register = jest.fn(async (_input: unknown) => undefined);
let queries: QueryClient;
const within = (ui: ReactElement) => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockUseStandIn = false;
  mockAsk.mockClear();
  mockToken.mockClear();
  register.mockClear();
  Object.assign(mockApi.api.account, { pushToken: { register: { mutate: register } } });
  mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
  mockApi.api.enrollments.get.query.mockResolvedValue(enrollment);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

const directions = ['rtl', 'ltr'] as const;
const said = (direction: (typeof directions)[number], key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

describe('the push ask (T020, FR-623)', () => {
  it.each(directions)(
    'after a confirmed booking: asked, and the token registered once (%s)',
    async (direction) => {
      await renderIn(direction, within(<PaymentSuccess />));
      expect(
        await screen.findByText(said(direction, 'student.checkoutConfirmed.title')),
      ).toBeTruthy();
      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
      expect(mockAsk).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledWith({ token: TOKEN, platform: 'ios' });
    },
  );

  it.each(directions)(
    'on the enrollment’s screen: asked, and the token registered once (%s)',
    async (direction) => {
      await renderIn(direction, within(<EnrollmentDetail />));
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
      expect(mockAsk).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledWith({ token: TOKEN, platform: 'ios' });
    },
  );

  it.each(directions)('refused: no token read, nothing registered (%s)', async (direction) => {
    mockAsk.mockResolvedValueOnce(false);
    await renderIn(direction, within(<EnrollmentDetail />));
    expect(await screen.findByText(TEACHER)).toBeTruthy();
    await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(1));
    expect(mockToken).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it.each(directions)('with the stand-in: never registered (%s)', async (direction) => {
    mockUseStandIn = true;
    await renderIn(direction, within(<PaymentSuccess />));
    expect(
      await screen.findByText(said(direction, 'student.checkoutConfirmed.title')),
    ).toBeTruthy();
    await cleanup();
    await renderIn(direction, within(<EnrollmentDetail />));
    expect(await screen.findByText(TEACHER)).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
    expect(mockAsk).not.toHaveBeenCalled();
  });

  it.each(directions)('never at sign-in (%s)', async (direction) => {
    setSession({ kind: 'signed-out' });
    mockApi.api.auth.email.signIn.mutate.mockResolvedValue({ ...tokens, landing: 'student_home' });
    await renderIn(direction, within(<EmailSignIn />));
    await fireEvent.changeText(
      screen.getByLabelText(said(direction, 'auth.field.email')),
      'amal@example.com',
    );
    await fireEvent.changeText(
      screen.getByLabelText(said(direction, 'auth.field.password')),
      'a long secret',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: said(direction, 'auth.emailSignIn.signIn') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockAsk).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
