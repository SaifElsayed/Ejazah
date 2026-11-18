// T074 of specs/004-sessions (FR-506; the note under T074, Q-O1 (a), Q-R7 (a), N3): the student sees
// an enrollment the server answers `paused` as «متوقف مؤقتًا», with no reason, in place of its
// status's word, in Arabic and English: on the active tab (a teacher's suspension keeps it
// `confirmed`), on the ended tab (a ban's or a revocation's held closing is `cancelled`), and on its
// detail. A paused item carries no session (no `next`, no `last`, the detail's `sessions` empty), so
// no session line and no session row is drawn; its three counts are drawn as the server answers
// them. An item not paused is drawn as before.
import type {
  EnrollmentsGetOutput,
  ListedSession,
  MeOutput,
  StudentEnrollmentItem,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatNumber } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { EnrollmentDetail, Enrollments, EnrollmentsEnded } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const TEACHER = 'الشيخ أحمد المصري';
const CAIRO = 'Africa/Cairo';

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;

function thursday(n: number): ListedSession {
  const day = String(5 + n * 7).padStart(2, '0');
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`,
    sequenceNumber: n,
    localDate: `2026-11-${day}`,
    startTimeLocal: '20:00',
    timezone: CAIRO,
    startsAt: `2026-11-${day}T18:00:00.000Z`,
    endsAt: `2026-11-${day}T18:45:00.000Z`,
    status: n === 1 ? 'done' : 'scheduled',
    pendingCancellation: false,
    disputed: false,
  };
}
const SESSIONS = [thursday(1), thursday(2), thursday(3)];

/** A running enrollment, not paused: one session held, the second next. */
const running: StudentEnrollmentItem = {
  enrollmentId: ENROLLMENT_ID,
  teacher: {
    teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
    displayName: TEACHER,
    displayNameOrNull: TEACHER,
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
function pausedAs(status: 'confirmed' | 'cancelled'): StudentEnrollmentItem {
  const { next: _next, last: _last, ...rest } = running;
  return { ...rest, status, paused: true, upcoming: 0, completed: 3, remaining: 5 };
}
const detailOf = (
  item: StudentEnrollmentItem,
  sessions: readonly ListedSession[],
): EnrollmentsGetOutput => ({
  ...item,
  sessions: [...sessions],
  complaintOpen: false,
  ijazahRequest: null,
});

const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
/** How many of the tabs read `word` (in English «Active» is the active tab's word and the badge's). */
const tabsSaying = (direction: Direction, word: string) =>
  (['student.enrollments.tabs.active', 'student.enrollments.tabs.ended'] as const).filter(
    (key) => said(direction, key) === word,
  ).length;
const STATUS_WORD = {
  confirmed: 'status.enrollment.confirmed',
  cancelled: 'status.enrollment.cancelled',
} as const satisfies Record<string, MessageKey>;

let queries: QueryClient;
const within = (ui: ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(async () => {
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
});

/** «متوقف مؤقتًا» in place of `status`'s word (beyond the tabs that say it), with no session line. */
function expectPausedCard(direction: Direction, status: keyof typeof STATUS_WORD): void {
  expect(screen.getAllByText(said(direction, 'status.enrollment.paused'))).toHaveLength(1);
  const word = said(direction, STATUS_WORD[status]);
  expect(screen.queryAllByText(word)).toHaveLength(tabsSaying(direction, word));
  expect(screen.queryByText(said(direction, 'student.enrollments.card.nextSession'))).toBeNull();
  expect(screen.queryByText(said(direction, 'student.enrollments.card.firstSession'))).toBeNull();
}

describe('the student’s lists draw a paused enrollment as «متوقف مؤقتًا» (T074, FR-506)', () => {
  it('on the active tab: the paused word in place of «جارٍ», no session line, the counts kept', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue({ items: [pausedAs('confirmed')] });
    await inBothDirections(within(<Enrollments />), async (_rendered, direction) => {
      const locale = direction === 'rtl' ? 'ar' : 'en';
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expectPausedCard(direction, 'confirmed');
      expect(screen.getByText(formatNumber(3, locale))).toBeTruthy();
      expect(screen.getByText(formatNumber(0, locale))).toBeTruthy();
      expect(screen.getByText(formatNumber(5, locale))).toBeTruthy();
    });
  });

  it('on the ended tab: the paused word in place of «ملغى», no session line', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue({ items: [pausedAs('cancelled')] });
    await inBothDirections(within(<EnrollmentsEnded />), async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expectPausedCard(direction, 'cancelled');
    });
  });

  it('an enrollment not paused: its status’s word and its next session, never the paused word', async () => {
    mockApi.api.enrollments.list.query.mockResolvedValue({ items: [running] });
    await inBothDirections(within(<Enrollments />), async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      const word = said(direction, 'status.enrollment.confirmed');
      expect(screen.getAllByText(word)).toHaveLength(tabsSaying(direction, word) + 1);
      expect(
        screen.getByText(said(direction, 'student.enrollments.card.nextSession')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'status.enrollment.paused'))).toBeNull();
    });
  });
});

describe('the student’s enrollment screen draws a paused enrollment as «متوقف مؤقتًا» (T074, FR-506)', () => {
  it.each<['confirmed' | 'cancelled']>([['confirmed'], ['cancelled']])(
    'a paused %s enrollment: the paused word in place of its status’s, no session row, the counts kept',
    async (status) => {
      mockApi.api.enrollments.get.query.mockResolvedValue(detailOf(pausedAs(status), []));
      await inBothDirections(within(<EnrollmentDetail />), async (_rendered, direction) => {
        const locale = direction === 'rtl' ? 'ar' : 'en';
        expect(await screen.findByText(TEACHER)).toBeTruthy();
        expect(screen.getAllByText(said(direction, 'status.enrollment.paused'))).toHaveLength(1);
        expect(screen.queryByText(said(direction, STATUS_WORD[status]))).toBeNull();
        expect(screen.queryByText(said(direction, 'student.enrollmentDetail.sessions'))).toBeNull();
        expect(screen.getByText(formatNumber(3, locale))).toBeTruthy();
        expect(screen.getByText(formatNumber(5, locale))).toBeTruthy();
      });
    },
  );

  it('an enrollment not paused: its status’s word and its sessions, never the paused word', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue(detailOf(running, SESSIONS));
    await inBothDirections(within(<EnrollmentDetail />), async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.confirmed'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.enrollmentDetail.sessions'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'status.enrollment.paused'))).toBeNull();
    });
  });
});
