// T041 of specs/004-sessions (FR-495; the note under T041, Q3 (a)): the student's enrollment screen
// draws the lists' per-session `pendingCancellation` on that session's row, in Arabic and English,
// and on no other row.
import type { EnrollmentsGetOutput, ListedSession, MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { fakeApi } from '../../shared/__tests__/api-double';
import { EnrollmentDetail } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const CAIRO = 'Africa/Cairo';

function thursday(n: number, of: Partial<ListedSession> = {}): ListedSession {
  const day = String(5 + n * 7).padStart(2, '0');
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`,
    sequenceNumber: n,
    localDate: `2026-11-${day}`,
    startTimeLocal: '20:00',
    timezone: CAIRO,
    startsAt: `2026-11-${day}T18:00:00.000Z`,
    endsAt: `2026-11-${day}T18:45:00.000Z`,
    status: 'scheduled',
    pendingCancellation: false,
    disputed: false,
    ...of,
  };
}

const sessions = [thursday(1), thursday(2, { pendingCancellation: true }), thursday(3)];

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
    sessionCount: 3,
    sessionDurationMinutes: 45,
  },
  status: 'confirmed',
  paused: false,
  next: sessions[0],
  last: sessions[2],
  upcoming: 3,
  completed: 0,
  remaining: 3,
  sessions,
  complaintOpen: false,
};

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
const said = (direction: Direction, key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

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

describe('EnrollmentDetail: a pending cancellation request (T041, FR-495)', () => {
  it('says a request is pending on the session that has one, and on no other', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue(detail);
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('الشيخ أحمد')).toBeTruthy();
      expect(screen.getAllByText(said(direction, 'session.cancellation.row.pending'))).toHaveLength(
        1,
      );
    });
  });

  it('says nothing of a request when no session has one pending', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue({
      ...detail,
      sessions: sessions.map((one) => ({ ...one, pendingCancellation: false })),
    });
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText('الشيخ أحمد')).toBeTruthy();
      expect(screen.queryByText(said(direction, 'session.cancellation.row.pending'))).toBeNull();
    });
  });
});
