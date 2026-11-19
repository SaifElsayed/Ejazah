// 003:T112 (SRS FR-POSTPONE-5, DEC-90): a postponed session in the teacher's day, in Arabic and
// English: its badge «مؤجلة», and which party postponed it with the reason (`postponement` of
// `teacher.today`'s listed session).
import type { TeacherTodaySession } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import type { Direction } from '../../../lib/direction';
import { fakeApi } from '../../shared/__tests__/api-double';
import { TeacherHome } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

const CAIRO = 'Africa/Cairo';
const STUDENT = 'نور سمير';
const REASON = 'سفر مع الأسرة';

const postponed: TeacherTodaySession = {
  enrollmentId: '0193a6f0-0000-7000-8000-0000000000e2',
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
  sessionId: '0193a6f0-0000-7000-8000-000000000604',
  sequenceNumber: 4,
  localDate: '2026-11-04',
  startTimeLocal: '14:00',
  timezone: CAIRO,
  startsAt: '2026-11-04T12:00:00.000Z',
  endsAt: '2026-11-04T12:45:00.000Z',
  status: 'postponed',
  pendingCancellation: false,
  disputed: false,
  postponement: { by: 'student', reason: REASON, at: '2026-11-02T09:00:00.000Z' },
};

const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);

let queries: QueryClient;
const home = () => (
  <QueryClientProvider client={queries}>
    <TeacherHome notice={<Text>notice</Text>} />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('TeacherHome: a postponed session in the day (T112, FR-POSTPONE-5)', () => {
  it('draws «مؤجلة» on the row, with who postponed it and the reason', async () => {
    mockApi.api.teacher.today.query.mockResolvedValue({
      localDate: '2026-11-04',
      timezone: CAIRO,
      sessions: [postponed],
    });
    await inBothDirections(home, async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.session.postponed'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'postponement.shown.byStudent', { reason: REASON })),
      ).toBeTruthy();
    });
  });
});
