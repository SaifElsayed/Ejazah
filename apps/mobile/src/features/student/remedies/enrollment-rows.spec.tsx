// T043 of specs/004-sessions (FR-495; the note under T041, Q3 (a)): the student's enrollment screen
// is the notice of a session's remedy until Phase 4's notifications: each session row draws the
// lists' `remedyStatus` in the student's words, in Arabic and English, and a session with none
// draws nothing more. The deadline is the session screen's (the lists carry the status only).
import type { EnrollmentsGetOutput, ListedSession, MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { fakeApi } from '../../shared/__tests__/api-double';
import { EnrollmentDetail } from '../enrollments';
import { remedyRowKey } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const CAIRO = 'Africa/Cairo';
const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;

const REMEDIES = [
  'awaiting_choice',
  'proposed',
  'counter_proposed',
  'frozen',
  'booked',
  'refund_case',
] as const;

/** Eight Wednesdays at 18:00 in Cairo; the first six owe a remedy, one of each status. */
const sessions: ListedSession[] = Array.from({ length: 8 }, (_, index) => {
  const day = String(4 + index).padStart(2, '0');
  const remedyStatus = REMEDIES[index];
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${day}`,
    sequenceNumber: index + 1,
    localDate: `2026-11-${day}`,
    startTimeLocal: '18:00',
    timezone: CAIRO,
    startsAt: `2026-11-${day}T16:00:00.000Z`,
    endsAt: `2026-11-${day}T16:45:00.000Z`,
    status: remedyStatus === undefined ? 'scheduled' : 'teacher_no_show',
    pendingCancellation: false,
    disputed: false,
    ...(remedyStatus === undefined ? {} : { remedyStatus }),
  };
});

const detail: EnrollmentsGetOutput = {
  enrollmentId: ENROLLMENT_ID,
  teacher: {
    teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
    displayName: 'الشيخ أحمد',
    displayNameOrNull: 'الشيخ أحمد',
    deleted: false,
  },
  summary: {
    subject: { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' },
    track: 'recitation',
    sessionCount: 8,
    sessionDurationMinutes: 45,
  },
  status: 'confirmed',
  next: sessions[6],
  last: sessions[7],
  upcoming: 2,
  completed: 0,
  remaining: 8,
  sessions,
  complaintOpen: false,
};

const said = (direction: Direction, key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

const ROW_WORDS: readonly MessageKey[] = [
  'student.remedy.row.awaitingChoice',
  'student.remedy.row.proposed',
  'student.remedy.row.counterProposed',
  'student.remedy.row.frozen',
  'student.remedy.row.booked',
  'student.remedy.row.refundCase',
];

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <EnrollmentDetail />
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

describe('EnrollmentDetail: each session’s remedy (FR-495)', () => {
  it('draws each remedy status once on its session’s row, in the student’s words', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue(detail);
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('الشيخ أحمد')).toBeTruthy();
      for (const key of ROW_WORDS)
        expect(screen.getAllByText(said(direction, key))).toHaveLength(1);
    });
  });

  it('draws no remedy line for a session with none', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue({
      ...detail,
      sessions: sessions.map(({ remedyStatus: _none, ...plain }) => plain),
    });
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('الشيخ أحمد')).toBeTruthy();
      for (const key of ROW_WORDS) expect(screen.queryByText(said(direction, key))).toBeNull();
    });
  });

  it('names a row only for the statuses the lists answer, nothing for any other', () => {
    expect(REMEDIES.map((status) => remedyRowKey(status)?.key)).toEqual(ROW_WORDS);
    expect(remedyRowKey(undefined)).toBeUndefined();
    expect(remedyRowKey('lapsed' as (typeof REMEDIES)[number])).toBeUndefined();
  });
});
