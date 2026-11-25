// 006:T019 (FR-708, SRS DEC-114; B-P4's conflict check, Q-3 (a), Q-5 (b)): the reminder on the
// enrollment's card, in Arabic and English. A programme's enrollment carries the server's marker; while
// `offered`, from its `payReminderFrom` on, the card says «ادفع قبل {date} {time}» with `payBy` in the
// student's zone. No line when the instant is null or still ahead, and none on an enrollment that is no
// programme. The phone reads no setting: the instant is the server's.
import type { MeOutput, StudentEnrollmentItem } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react-native';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatDate, formatTime } from '../../../lib/formatters';
import { fakeApi } from '../../shared/__tests__/api-double';
import { Enrollments } from '../enrollments';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد المصري';
/** Wednesday 25 November 18:00 in Cairo. */
const PAY_BY = '2026-11-25T16:00:00.000Z';
/** The phone's clock is real here: an instant long past, and one far ahead. */
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

const item = (programme?: StudentEnrollmentItem['programme']): StudentEnrollmentItem => ({
  enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1',
  teacher: {
    teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
    displayName: TEACHER,
    displayNameOrNull: TEACHER,
    deleted: false,
  },
  summary: {
    subject: { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' },
    track: 'ijazah_track',
    sessionCount: 1,
    sessionDurationMinutes: 30,
  },
  status: 'confirmed',
  paused: false,
  upcoming: 0,
  completed: 1,
  remaining: 0,
  ...(programme === undefined ? {} : { programme }),
});

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const reminder = (direction: Direction) =>
  said(direction, 'programme.student.payReminder', {
    date: formatDate(PAY_BY, CAIRO, direction === 'rtl' ? 'ar' : 'en'),
    time: formatTime(PAY_BY, CAIRO, direction === 'rtl' ? 'ar' : 'en'),
  });

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <Enrollments />
  </QueryClientProvider>
);
const listing = (one: StudentEnrollmentItem) =>
  mockApi.api.enrollments.list.query.mockResolvedValue({ items: [one] });

beforeEach(() => {
  mockApi = fakeApi();
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('the card’s reminder (FR-708, SRS DEC-114)', () => {
  it('from payReminderFrom on: «pay before» with payBy as a date and a time', async () => {
    listing(item({ state: 'offered', payBy: PAY_BY, payReminderFrom: PAST }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.getByText(reminder(direction))).toBeTruthy();
    });
  });

  it('no line when payReminderFrom is null', async () => {
    listing(item({ state: 'offered', payBy: PAY_BY, payReminderFrom: null }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.queryByText(reminder(direction))).toBeNull();
    });
  });

  it('no line when payReminderFrom is in the future', async () => {
    listing(item({ state: 'offered', payBy: PAY_BY, payReminderFrom: FUTURE }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.queryByText(reminder(direction))).toBeNull();
    });
  });

  it('no line on an enrollment that is no programme', async () => {
    listing(item());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.queryByText(reminder(direction))).toBeNull();
    });
  });
});
