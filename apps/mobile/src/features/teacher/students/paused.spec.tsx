// T074 of specs/004-sessions (FR-506; the note under T074, Q-O1 (a), Q-R7 (a), N3): the teacher sees
// an enrollment the server answers `paused` as «متوقف مؤقتًا», with no reason, in place of its
// status's word, in Arabic and English: on «طلابي»'s active tab (`confirmed`), on its ended tab
// (`cancelled`), and on the enrollment's screen. A paused item carries no session (no `next`, no
// `last`, the detail's `sessions` empty): the row says what was done of the package, never a
// session's line, and the screen draws no session row; the counts are the server's. An item not
// paused is drawn as before.
import type {
  ListedSession,
  TeacherStudentItem,
  TeacherStudentsGetOutput,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatNumber } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { TeacherEnrollment, TeacherStudents, TeacherStudentsEnded } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const STUDENT = 'نور سمير';
const CAIRO = 'Africa/Cairo';

/** Wednesdays at 18:00 in Cairo (16:00 UTC) from 2026-11-11. */
const WEDNESDAYS = ['2026-11-11', '2026-11-18', '2026-11-25'];
function wednesday(n: number): ListedSession {
  const date = WEDNESDAYS[n - 1]!;
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`,
    sequenceNumber: n,
    localDate: date,
    startTimeLocal: '18:00',
    timezone: CAIRO,
    startsAt: `${date}T16:00:00.000Z`,
    endsAt: `${date}T16:45:00.000Z`,
    status: n === 1 ? 'done' : 'scheduled',
    pendingCancellation: false,
    disputed: false,
  };
}
const SESSIONS = [wednesday(1), wednesday(2), wednesday(3)];

/** A running enrollment, not paused: one session held, the second next. */
const running: TeacherStudentItem = {
  enrollmentId: ENROLLMENT_ID,
  student: {
    studentId: '0193a6f0-0000-7000-8000-0000000000b9',
    displayName: STUDENT,
    displayNameOrNull: STUDENT,
    deleted: false,
  },
  summary: {
    subject: { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' },
    track: 'recitation',
    sessionCount: 8,
    sessionDurationMinutes: 45,
  },
  status: 'confirmed',
  paused: false,
  next: SESSIONS[1],
  last: SESSIONS[2],
  upcoming: 2,
  completed: 1,
  remaining: 7,
};

/** Paused as the server answers it: no `next`, no `last`, the counts kept. */
function pausedAs(status: 'confirmed' | 'cancelled'): TeacherStudentItem {
  const { next: _next, last: _last, ...rest } = running;
  return { ...rest, status, paused: true, upcoming: 4, completed: 3, remaining: 5 };
}
const detailOf = (
  item: TeacherStudentItem,
  sessions: readonly ListedSession[],
): TeacherStudentsGetOutput => ({ ...item, sessions: [...sessions], ijazahRequest: null });

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const STATUS_WORD = {
  confirmed: 'status.enrollment.confirmed',
  cancelled: 'status.enrollment.cancelled',
} as const satisfies Record<string, MessageKey>;
/** Any row's session line: the template's words before its first value. */
const sessionLine = (direction: Direction) => {
  const [opening = ''] = said(direction, 'teacher.students.sessionOn', {
    n: '§',
    total: '§',
    date: '§',
    time: '§',
  }).split('§');
  return new RegExp(`^${opening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
};

let queries: QueryClient;
const within = (ui: ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, {
    userId: '0193a6f0-0000-7000-8000-000000000002',
    role: 'teacher',
    displayName: 'سارة عادل',
    timezone: CAIRO,
  });
});
afterEach(async () => {
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
});

/** The row: «متوقف مؤقتًا» in place of `status`'s word, what was done of the package, no session line. */
function expectPausedRow(direction: Direction, status: keyof typeof STATUS_WORD): void {
  expect(screen.getAllByText(said(direction, 'status.enrollment.paused'))).toHaveLength(1);
  expect(screen.queryByText(said(direction, STATUS_WORD[status]))).toBeNull();
  expect(
    screen.getByText(said(direction, 'common.format.progress', { done: 3, total: 8 })),
  ).toBeTruthy();
  expect(screen.queryByText(sessionLine(direction))).toBeNull();
}

describe('«طلابي» draws a paused enrollment as «متوقف مؤقتًا» (T074, FR-506)', () => {
  it('on the active tab: the paused word in place of «جارٍ», no session line', async () => {
    mockApi.api.teacher.students.list.query.mockResolvedValue({ items: [pausedAs('confirmed')] });
    await inBothDirections(within(<TeacherStudents />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expectPausedRow(direction, 'confirmed');
    });
  });

  it('on the ended tab: the paused word in place of «ملغى», no session line', async () => {
    mockApi.api.teacher.students.list.query.mockResolvedValue({ items: [pausedAs('cancelled')] });
    await inBothDirections(within(<TeacherStudentsEnded />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expectPausedRow(direction, 'cancelled');
    });
  });

  it('an enrollment not paused: its status’s word and its session line, never the paused word', async () => {
    mockApi.api.teacher.students.list.query.mockResolvedValue({ items: [running] });
    await inBothDirections(within(<TeacherStudents />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.confirmed'))).toBeTruthy();
      expect(screen.getByText(sessionLine(direction))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'status.enrollment.paused'))).toBeNull();
    });
  });
});

describe('the teacher’s enrollment screen draws a paused enrollment as «متوقف مؤقتًا» (T074, FR-506)', () => {
  it.each<['confirmed' | 'cancelled']>([['confirmed'], ['cancelled']])(
    'a paused %s enrollment: the paused word in place of its status’s, no session row, the counts kept',
    async (status) => {
      mockApi.api.teacher.students.get.query.mockResolvedValue(detailOf(pausedAs(status), []));
      await inBothDirections(within(<TeacherEnrollment />), async (_rendered, direction) => {
        const locale = localeOf(direction);
        expect(await screen.findByText(STUDENT)).toBeTruthy();
        expect(screen.getAllByText(said(direction, 'status.enrollment.paused'))).toHaveLength(1);
        expect(screen.queryByText(said(direction, STATUS_WORD[status]))).toBeNull();
        expect(screen.queryByText(said(direction, 'teacher.enrollment.sessions.title'))).toBeNull();
        expect(screen.getByText(formatNumber(3, locale))).toBeTruthy();
        expect(screen.getByText(formatNumber(4, locale))).toBeTruthy();
      });
    },
  );

  it('an enrollment not paused: its status’s word and its sessions, never the paused word', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue(detailOf(running, SESSIONS));
    await inBothDirections(within(<TeacherEnrollment />), async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.confirmed'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.enrollment.sessions.title'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'status.enrollment.paused'))).toBeNull();
    });
  });
});
