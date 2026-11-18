// T045 of specs/004-sessions (FR-488 to FR-492): the student's chat, in both languages. The screen
// reads the enrollment for the teacher's name and its status and draws the chat both roles share
// (features/shared/chat, whose spec holds the pages, the send, the documents and the live merge):
// open while the enrollment is confirmed, read-only once it has ended. A failed read of the
// enrollment says so in plain words (`genericErrorKey`), and a link with no enrollment id reads
// nothing. The detail offers the chat from the confirmation (approved beyond the task's files, the
// owner's decision of 2026-11-12, Q8), never while the enrollment awaits its payment. The route sits
// beside the detail's: `/enrollments/{id}` is the detail, `/enrollments/{id}/chat` the chat.
import type {
  ChatListOutput,
  EnrollmentsGetOutput,
  ListedSession,
  MeOutput,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { renderIn } from '../../../design/primitives/__tests__/harness';
import { type Locale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import {
  apiError,
  CHECKOUT_POLLING,
  fakeApi,
  type Procedure,
} from '../../shared/__tests__/api-double';
import { EnrollmentDetail } from '../enrollments';
import { STUDENT_CHAT_ROUTE, StudentChat } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
// 005:T021: the report's idempotency key.
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `report-key-${++mockKey}` }));

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockPush(route),
    navigate: (route: unknown) => mockPush(route),
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
const TEACHER = 'الشيخ أحمد المصري';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل حسن',
  timezone: 'Asia/Riyadh',
  accountStatus: 'active',
  landing: 'student_home',
} as unknown as MeOutput;

const session: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-19',
  startTimeLocal: '20:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-19T18:00:00Z',
  endsAt: '2026-11-19T18:45:00Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
};

function enrollment(of: Partial<EnrollmentsGetOutput> = {}): EnrollmentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    teacher: {
      teacherId: TEACHER_ID,
      displayName: TEACHER,
      displayNameOrNull: TEACHER,
      deleted: false,
    },
    summary: { subject: QURAN, track: 'recitation', sessionCount: 1, sessionDurationMinutes: 45 },
    status: 'confirmed',
    next: session,
    last: session,
    upcoming: 1,
    completed: 0,
    remaining: 1,
    sessions: [session],
    complaintOpen: false,
    ijazahRequest: null,
    ...of,
  } as EnrollmentsGetOutput;
}

const firstPage: ChatListOutput = {
  messages: [
    {
      messageId: '0193a6f0-0000-7000-8000-0000000000f1',
      mine: false,
      body: 'أهلًا بك',
      sentAt: '2026-11-12T10:00:00.000Z',
      purged: false,
    },
  ],
};

const localeOf = (direction: Direction): Locale => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);

let queries: QueryClient;
let list: Procedure;

function arrange() {
  mockApi = fakeApi();
  list = jest.fn(async () => firstPage) as Procedure;
  Object.assign(mockApi.api, {
    chat: {
      list: { query: list },
      send: { mutate: jest.fn(async () => undefined) as Procedure },
      attachmentLink: { query: jest.fn(async () => undefined) as Procedure },
    },
  });
  mockApi.value.client.publicConfig.mockResolvedValue({
    supportEmail: 'support@ijazah.test',
    termsVersion: '2026-10',
    checkout: CHECKOUT_POLLING,
    teacherSharePercent: 70,
    paymentMode: 'test',
  });
  mockPush.mockReset();
  mockBack.mockReset();
  mockParams = { id: ENROLLMENT_ID };
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
}

beforeEach(arrange);
afterEach(async () => {
  await cleanup();
  queries.clear();
});

const within = (ui: ReactElement) => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

/** `check` on a fresh render in each language, the cache and the mocks fresh each time. */
async function inEach(
  set: () => void,
  ui: () => ReactElement,
  check: (direction: Direction) => Promise<void>,
) {
  for (const direction of ['rtl', 'ltr'] as const) {
    arrange();
    set();
    await renderIn(direction, within(ui()));
    await check(direction);
    await cleanup();
    queries.clear();
  }
}

describe('StudentChat (T045, FR-488)', () => {
  it('reads the enrollment and draws its chat with the teacher, open while it is confirmed', async () => {
    await inEach(
      () => mockApi.api.enrollments.get.query.mockResolvedValue(enrollment()),
      () => <StudentChat />,
      async (direction) => {
        expect(await screen.findByText('أهلًا بك')).toBeTruthy();
        expect(screen.getByText(TEACHER)).toBeTruthy();
        expect(screen.getByText(said(direction, 'chat.thread.title'))).toBeTruthy();
        expect(screen.getByLabelText(said(direction, 'chat.message'))).toBeTruthy();
        expect(mockApi.api.enrollments.get.query.mock.calls).toEqual([
          [{ enrollmentId: ENROLLMENT_ID }],
        ]);
        expect(list.mock.calls).toEqual([[{ enrollmentId: ENROLLMENT_ID }]]);
      },
    );
  });

  it('is read-only once the enrollment has ended', async () => {
    await inEach(
      () =>
        mockApi.api.enrollments.get.query.mockResolvedValue(enrollment({ status: 'completed' })),
      () => <StudentChat />,
      async (direction) => {
        expect(await screen.findByText('أهلًا بك')).toBeTruthy();
        expect(screen.getByText(said(direction, 'chat.thread.readOnly'))).toBeTruthy();
        expect(screen.queryByLabelText(said(direction, 'chat.message'))).toBeNull();
      },
    );
  });

  it('says a refused read of the enrollment in plain words, RATE_LIMITED as «طلبات كثيرة…»', async () => {
    await inEach(
      () => mockApi.api.enrollments.get.query.mockRejectedValue(apiError('RATE_LIMITED')),
      () => <StudentChat />,
      async (direction) => {
        expect(await screen.findByText(said(direction, 'common.state.rateLimited'))).toBeTruthy();
        expect(list).not.toHaveBeenCalled();
      },
    );
  });

  it('reads nothing for a link with no enrollment id, and says it could not load', async () => {
    await inEach(
      () => {
        mockParams = {};
      },
      () => <StudentChat />,
      async (direction) => {
        expect(await screen.findByText(said(direction, 'common.state.loadError'))).toBeTruthy();
        expect(mockApi.api.enrollments.get.query).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
      },
    );
  });
});

describe('the chat’s entry on the enrollment’s detail (T045, Q8)', () => {
  it.each(['confirmed', 'completed', 'cancelled'] as const)(
    'offers the chat once %s, and opens it on the enrollment',
    async (status) => {
      await inEach(
        () => mockApi.api.enrollments.get.query.mockResolvedValue(enrollment({ status })),
        () => <EnrollmentDetail />,
        async (direction) => {
          await screen.findByText(TEACHER);
          await fireEvent.press(await screen.findByText(said(direction, 'chat.thread.title')));
          expect(mockPush.mock.calls).toEqual([
            [{ pathname: '/(student)/enrollments/[id]/chat', params: { id: ENROLLMENT_ID } }],
          ]);
          expect(STUDENT_CHAT_ROUTE).toBe('/(student)/enrollments/[id]/chat');
        },
      );
    },
  );

  it('offers no chat while the enrollment awaits its payment', async () => {
    await inEach(
      () => {
        mockApi.api.enrollments.get.query.mockResolvedValue(
          enrollment({ status: 'pending_payment', sessions: [] }),
        );
        mockApi.api.checkout.status.query.mockReturnValue(new Promise(() => undefined));
      },
      () => <EnrollmentDetail />,
      async (direction) => {
        await screen.findByText(TEACHER);
        expect(screen.queryByText(said(direction, 'chat.thread.title'))).toBeNull();
      },
    );
  });
});

// 005:T021 (FR-611; the note under T021, Q-T4 (a)): the report from the chat, on the teacher
// `enrollments.get` names (`teacher.teacherId`), naming the chat's enrollment.
describe('the report from the chat (005:T021, FR-611)', () => {
  it('reports the teacher, naming the enrollment, and answers «received» only', async () => {
    let create = jest.fn(async (_input: unknown) => ({ received: true }));
    await inEach(
      () => {
        create = jest.fn(async (_input: unknown) => ({ received: true }));
        Object.assign(mockApi.api, {
          reports: { create: { mutate: create } },
          genderFlags: { raise: { mutate: jest.fn(async () => ({ received: true })) } },
        });
        mockApi.api.enrollments.get.query.mockResolvedValue(enrollment());
      },
      () => <StudentChat />,
      async (direction) => {
        expect(await screen.findByText('أهلًا بك')).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'common.a11y.report') }),
        );
        expect(
          screen.getByText(said(direction, 'student.report.title', { teacher: TEACHER })),
        ).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('radio', { name: said(direction, 'student.report.reasons.fraud') }),
        );
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'student.report.submit') }),
        );
        expect(await screen.findByText(said(direction, 'common.toast.reportSent'))).toBeTruthy();
        expect(create.mock.calls).toEqual([
          [
            {
              reportedUserId: TEACHER_ID,
              context: 'chat',
              enrollmentId: ENROLLMENT_ID,
              reason: said(direction, 'student.report.reasons.fraud'),
              idempotencyKey: expect.any(String),
            },
          ],
        ]);
      },
    );
  });
});
