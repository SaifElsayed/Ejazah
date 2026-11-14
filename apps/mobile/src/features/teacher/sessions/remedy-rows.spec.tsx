// T044 of specs/004-sessions (FR-495; the note under T041, Q3 (a)): the teacher's enrollment screen
// is the notice of a session's remedy until Phase 4's notifications: each session row draws the
// lists' `remedyStatus` in the teacher's words, in Arabic and English. A session owing a remedy is
// a row of its own, never folded into a range of its status (`session-rows.ts`), so its line shows;
// a session with none draws nothing more, and three of one status with none still fold.
import type { ListedSession, MeOutput, TeacherStudentsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatWeekdayDate } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { TeacherEnrollment } from '../students';
import { sessionRows } from '../students/session-rows';
import { teacherRemedyRowKey } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const CAIRO = 'Africa/Cairo';
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;

const REMEDIES = [
  'awaiting_choice',
  'proposed',
  'counter_proposed',
  'frozen',
  'booked',
  'refund_case',
] as const;

/** Eight Wednesdays at 18:00 in Cairo; the first six were Teacher-No-Shows, each owing a remedy. */
function sessionsWith(
  remedies: readonly (ListedSession['remedyStatus'] | null)[],
): ListedSession[] {
  return Array.from({ length: 8 }, (_, index) => {
    const day = String(4 + index).padStart(2, '0');
    const remedyStatus = remedies[index] ?? undefined;
    return {
      sessionId: `0193a6f0-0000-7000-8000-0000000005${day}`,
      sequenceNumber: index + 1,
      localDate: `2026-11-${day}`,
      startTimeLocal: '18:00',
      timezone: CAIRO,
      startsAt: `2026-11-${day}T16:00:00.000Z`,
      endsAt: `2026-11-${day}T16:45:00.000Z`,
      status: index < 6 ? 'teacher_no_show' : 'scheduled',
      pendingCancellation: false,
      disputed: false,
      ...(remedyStatus === undefined ? {} : { remedyStatus }),
    };
  });
}

function enrollment(sessions: ListedSession[]): TeacherStudentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: { displayName: 'يوسف أحمد', displayNameOrNull: 'يوسف أحمد', deleted: false },
    summary: {
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran',
      },
      track: 'recitation',
      sessionCount: 8,
      sessionDurationMinutes: 45,
    },
    status: 'confirmed',
    paused: false,
    next: sessions[6],
    last: sessions[7],
    upcoming: 2,
    completed: 0,
    remaining: 8,
    sessions,
  };
}

const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);

const ROW_WORDS: readonly MessageKey[] = [
  'teacher.counter.row.awaitingChoice',
  'teacher.counter.row.proposed',
  'teacher.counter.row.counterProposed',
  'teacher.counter.row.frozen',
  'teacher.counter.row.booked',
  'teacher.counter.row.refundCase',
];

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <TeacherEnrollment />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('TeacherEnrollment: each session’s remedy (FR-495)', () => {
  it('draws each remedy status once, on the session’s own row', async () => {
    const sessions = sessionsWith(REMEDIES);
    mockApi.api.teacher.students.get.query.mockResolvedValue(enrollment(sessions));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      for (const key of ROW_WORDS)
        expect(screen.getAllByText(said(direction, key))).toHaveLength(1);
      for (const session of sessions.slice(0, 6)) {
        expect(
          screen.getByText(
            said(direction, 'teacher.enrollment.sessions.row', {
              n: session.sequenceNumber,
              date: formatWeekdayDate(
                session.startsAt,
                session.timezone,
                direction === 'rtl' ? 'ar' : 'en',
              ),
            }),
          ),
        ).toBeTruthy();
      }
    });
  });

  it('draws no remedy line for a session with none', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue(enrollment(sessionsWith([])));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('يوسف أحمد')).toBeTruthy();
      for (const key of ROW_WORDS) expect(screen.queryByText(said(direction, key))).toBeNull();
    });
  });

  it('names a row only for the statuses the lists answer, nothing for any other', () => {
    expect(REMEDIES.map((status) => teacherRemedyRowKey(status)?.key)).toEqual(ROW_WORDS);
    expect(teacherRemedyRowKey(undefined)).toBeUndefined();
    expect(teacherRemedyRowKey('lapsed' as (typeof REMEDIES)[number])).toBeUndefined();
  });
});

describe('sessionRows: a session owing a remedy stands alone', () => {
  const shape = (rows: ReturnType<typeof sessionRows>) =>
    rows.map((row) =>
      row.kind === 'range'
        ? `${row.first.sequenceNumber}-${row.last.sequenceNumber}`
        : `${row.session.sequenceNumber}${row.next ? '*' : ''}`,
    );

  it('breaks a range at a session with a remedy, which is a row of its own', () => {
    const sessions = sessionsWith([null, null, null, 'counter_proposed', null, null]);
    expect(shape(sessionRows(sessions, 7))).toEqual(['1-3', '4', '5', '6', '7*', '8']);
  });

  it('still folds three of one status with no remedy into one range', () => {
    expect(shape(sessionRows(sessionsWith([]), 7))).toEqual(['1-6', '7*', '8']);
  });
});
