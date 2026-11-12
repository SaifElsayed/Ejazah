// T045 of specs/004-sessions (FR-488 to FR-492): the teacher's chat, in both languages. The screen
// reads the enrollment (`teacher.students.get`) for the student's name and its status, deciding only
// on what it read since it opened, and draws the chat both roles share (features/shared/chat, whose
// spec holds the pages, the send, the documents and the live merge): open while the enrollment is
// confirmed, read-only once it has ended. A failed read says so in plain words (`genericErrorKey`),
// and a link with no enrollment id reads nothing. The enrollment's screen offers the chat from the
// confirmation (approved beyond the task's files, the owner's decision of 2026-11-12, Q8). The route
// sits beside the enrollment's: `/students/{id}` is the enrollment, `/students/{id}/chat` its chat.
import type { ChatListOutput, ListedSession, TeacherStudentsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { renderIn } from '../../../design/primitives/__tests__/harness';
import { type Locale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi, type Procedure } from '../../shared/__tests__/api-double';
import { TeacherEnrollment } from '../students';
import { TEACHER_CHAT_ROUTE, TeacherChat } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockPush(route), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const STUDENT = 'يوسف أحمد';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: 'Africa/Cairo' };

const session: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-18',
  startTimeLocal: '18:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-18T16:00:00.000Z',
  endsAt: '2026-11-18T16:45:00.000Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
};

function enrollment(of: Partial<TeacherStudentsGetOutput> = {}): TeacherStudentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: { displayName: STUDENT, displayNameOrNull: STUDENT, deleted: false },
    summary: { subject: QURAN, track: 'recitation', sessionCount: 1, sessionDurationMinutes: 45 },
    status: 'confirmed',
    next: session,
    last: session,
    upcoming: 1,
    completed: 0,
    remaining: 1,
    sessions: [session],
    ...of,
  } as TeacherStudentsGetOutput;
}

const firstPage: ChatListOutput = {
  messages: [
    {
      messageId: '0193a6f0-0000-7000-8000-0000000000f1',
      mine: false,
      body: 'متى نبدأ سورة البقرة؟',
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
const get = () => mockApi.api.teacher.students.get.query;

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
  mockPush.mockReset();
  mockBack.mockReset();
  mockParams = { enrollmentId: ENROLLMENT_ID };
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

describe('TeacherChat (T045, FR-488)', () => {
  it('reads the enrollment and draws its chat with the student, open while it is confirmed', async () => {
    await inEach(
      () => get().mockResolvedValue(enrollment()),
      () => <TeacherChat />,
      async (direction) => {
        expect(await screen.findByText('متى نبدأ سورة البقرة؟')).toBeTruthy();
        expect(screen.getByText(STUDENT)).toBeTruthy();
        expect(screen.getByText(said(direction, 'chat.thread.title'))).toBeTruthy();
        expect(screen.getByLabelText(said(direction, 'chat.message'))).toBeTruthy();
        expect(get().mock.calls).toEqual([[{ enrollmentId: ENROLLMENT_ID }]]);
        expect(list.mock.calls).toEqual([[{ enrollmentId: ENROLLMENT_ID }]]);
      },
    );
  });

  it('is read-only once the enrollment has ended', async () => {
    await inEach(
      () => get().mockResolvedValue(enrollment({ status: 'terminated_no_show' })),
      () => <TeacherChat />,
      async (direction) => {
        expect(await screen.findByText('متى نبدأ سورة البقرة؟')).toBeTruthy();
        expect(screen.getByText(said(direction, 'chat.thread.readOnly'))).toBeTruthy();
        expect(screen.queryByLabelText(said(direction, 'chat.message'))).toBeNull();
      },
    );
  });

  it('says a refused read of the enrollment in plain words, RATE_LIMITED as «طلبات كثيرة…»', async () => {
    await inEach(
      () =>
        get().mockRejectedValue(
          apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '45' }]),
        ),
      () => <TeacherChat />,
      async (direction) => {
        expect(
          await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count: 1 })),
        ).toBeTruthy();
        expect(list).not.toHaveBeenCalled();
      },
    );
  });

  it('reads nothing for a link with no enrollment id, and says it could not load', async () => {
    await inEach(
      () => {
        mockParams = {};
      },
      () => <TeacherChat />,
      async (direction) => {
        expect(await screen.findByText(said(direction, 'common.state.loadError'))).toBeTruthy();
        expect(get()).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
      },
    );
  });
});

describe('the chat’s entry on the teacher’s enrollment (T045, Q8)', () => {
  it.each(['confirmed', 'completed', 'cancelled'] as const)(
    'offers the chat once %s, and opens it on the enrollment',
    async (status) => {
      await inEach(
        () => get().mockResolvedValue(enrollment({ status })),
        () => <TeacherEnrollment />,
        async (direction) => {
          await screen.findByText(STUDENT);
          await fireEvent.press(await screen.findByText(said(direction, 'chat.thread.title')));
          expect(mockPush.mock.calls).toEqual([
            [
              {
                pathname: '/(teacher)/students/[enrollmentId]/chat',
                params: { enrollmentId: ENROLLMENT_ID },
              },
            ],
          ]);
          expect(TEACHER_CHAT_ROUTE).toBe('/(teacher)/students/[enrollmentId]/chat');
        },
      );
    },
  );

  it('offers no chat while the enrollment awaits its payment', async () => {
    await inEach(
      () => get().mockResolvedValue(enrollment({ status: 'pending_payment' })),
      () => <TeacherEnrollment />,
      async (direction) => {
        await screen.findByText(STUDENT);
        expect(screen.queryByText(said(direction, 'chat.thread.title'))).toBeNull();
      },
    );
  });
});
