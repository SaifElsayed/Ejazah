// T042 of specs/004-sessions (FR-452, FR-495; SRS FR-NOSHOW-4; T060; the note under T042, Q6 (a)):
// the complaint of the teacher's absence on the student's enrollment screen, in Arabic and English.
// On a `confirmed` enrollment, a button taking a mandatory reason (nothing sent while it is blank),
// sent unkeyed; while `complaintOpen` is true the button reads «شكوتك قيد المراجعة» and sends
// nothing; no button on an enrollment that is not confirmed. `COMPLAINT_OPEN` in plain words; the
// complaint's own `RATE_LIMITED` words, with the time from `retryAfterSeconds` when given and without
// one otherwise, never a count of complaints; every other failure through `genericErrorKey`.
import type { EnrollmentsGetOutput, ListedSession, MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { complaintRefusal } from './complaint';
import { EnrollmentDetail } from './index';

let mockApi = fakeApi();
const mockRaise = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const COMPLAINT_ID = '0193a6f0-0000-7000-8000-0000000000f2';
const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد';

const first: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-19',
  startTimeLocal: '20:00',
  timezone: CAIRO,
  startsAt: '2026-11-19T18:00:00.000Z',
  endsAt: '2026-11-19T18:45:00.000Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
};

function detail(of: Partial<EnrollmentsGetOutput> = {}): EnrollmentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    teacher: {
      teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
      displayName: TEACHER,
      displayNameOrNull: TEACHER,
      deleted: false,
    },
    summary: {
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran',
      },
      track: 'recitation',
      sessionCount: 1,
      sessionDurationMinutes: 45,
    },
    status: 'confirmed',
    next: first,
    last: first,
    upcoming: 1,
    completed: 0,
    remaining: 1,
    sessions: [first],
    complaintOpen: false,
    ...of,
  };
}

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const get = () => mockApi.api.enrollments.get.query;
const button = (direction: Direction, key: MessageKey) =>
  screen.getByRole('button', { name: said(direction, key) });

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <EnrollmentDetail />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockRaise.mockReset();
  Object.assign(mockApi.api, { sessions: { complaint: { raise: { mutate: mockRaise } } } });
  // The awaiting-payment case reads its last order (T050); it says nothing of the complaint.
  mockApi.api.checkout.status.query.mockResolvedValue({
    status: 'pending_payment',
    lastOrder: { status: 'created', reference: 'IJZ-7Q4K2M' },
    summary: {
      teacher: { teacherId: '0193a6f0-0000-7000-8000-0000000000d1', displayName: TEACHER },
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran',
      },
      track: 'recitation',
      sessionCount: 1,
      sessionDurationMinutes: 45,
      price_piasters: 60_000,
    },
  });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

async function writeReason(direction: Direction, text: string): Promise<void> {
  expect(await screen.findByText(TEACHER)).toBeTruthy();
  await fireEvent.press(button(direction, 'student.complaint.raise'));
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, 'student.complaint.form.reason')),
    text,
  );
}

describe('EnrollmentDetail: the complaint of the teacher’s absence (T042, FR-452)', () => {
  it('sends the student’s reason on a confirmed enrollment, then reads «under review»', async () => {
    get().mockResolvedValue(detail());
    mockRaise.mockResolvedValue({ complaintId: COMPLAINT_ID, status: 'open' });
    await inBothDirections(ui, async (_rendered, direction) => {
      await writeReason(direction, '  لم يحضر المعلم ثلاث مرات  ');
      expect(screen.getByText(said(direction, 'student.complaint.form.hint'))).toBeTruthy();
      get().mockResolvedValue(detail({ complaintOpen: true }));
      await act(async () => {
        await fireEvent.press(button(direction, 'student.complaint.form.send'));
      });
      expect(await screen.findByText(said(direction, 'student.complaint.open'))).toBeTruthy();
      get().mockResolvedValue(detail());
    });
    expect(mockRaise).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      reason: 'لم يحضر المعلم ثلاث مرات',
    });
  });

  it('reads «شكوتك قيد المراجعة» while complaintOpen is true, the button sending nothing', async () => {
    get().mockResolvedValue(detail({ complaintOpen: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      const open = button(direction, 'student.complaint.open');
      expect(open.props.accessibilityState?.disabled).toBe(true);
      await fireEvent.press(open);
      expect(
        screen.queryByRole('button', { name: said(direction, 'student.complaint.raise') }),
      ).toBeNull();
    });
    expect(said('rtl', 'student.complaint.open')).toBe('شكوتك قيد المراجعة');
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('offers no complaint on an enrollment that is not confirmed', async () => {
    for (const status of [
      'completed',
      'pending_payment',
      'terminated_no_show',
      'cancelled',
    ] as const) {
      get().mockResolvedValue(detail({ status }));
      await inBothDirections(ui, async (_rendered, direction) => {
        expect(await screen.findByText(TEACHER)).toBeTruthy();
        expect(
          screen.queryByRole('button', { name: said(direction, 'student.complaint.raise') }),
        ).toBeNull();
        expect(
          screen.queryByRole('button', { name: said(direction, 'student.complaint.open') }),
        ).toBeNull();
      });
    }
  });

  it('sends nothing while the reason is blank', async () => {
    get().mockResolvedValue(detail());
    await inBothDirections(ui, async (_rendered, direction) => {
      await writeReason(direction, '  ');
      const send = button(direction, 'student.complaint.form.send');
      expect(send.props.accessibilityState?.disabled).toBe(true);
      await fireEvent.press(send);
    });
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('says COMPLAINT_OPEN in plain words, the button then reading «under review»', async () => {
    get().mockResolvedValue(detail());
    await renderIn('rtl', ui());
    await writeReason('rtl', 'لم يحضر المعلم');
    mockRaise.mockRejectedValueOnce(
      apiError('COMPLAINT_OPEN', [{ path: 'complaintId', code: COMPLAINT_ID }]),
    );
    get().mockResolvedValue(detail({ complaintOpen: true }));
    await act(async () => {
      await fireEvent.press(button('rtl', 'student.complaint.form.send'));
    });
    expect(await screen.findByText(said('rtl', 'student.complaint.refused.open'))).toBeTruthy();
    expect(button('rtl', 'student.complaint.open')).toBeTruthy();
  });

  it('says RATE_LIMITED in the complaint’s own words, with the time when given and without it otherwise', async () => {
    get().mockResolvedValue(detail());
    const refusals = [
      [
        apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '600' }]),
        'student.complaint.refused.rateLimitedIn',
        { count: 10 },
      ],
      [apiError('RATE_LIMITED'), 'student.complaint.refused.rateLimited', undefined],
      [new TypeError('Network request failed'), 'common.state.actionError', undefined],
    ] as const;
    await inBothDirections(ui, async (_rendered, direction) => {
      await writeReason(direction, 'لم يحضر المعلم');
      for (const [error, key, values] of refusals) {
        mockRaise.mockRejectedValueOnce(error);
        await act(async () => {
          await fireEvent.press(button(direction, 'student.complaint.form.send'));
        });
        expect(await screen.findByText(said(direction, key, values))).toBeTruthy();
      }
    });
  });
});

describe('complaintRefusal (T042, Q6 (a))', () => {
  it('reads the time as genericErrorKey does: whole minutes rounded up, at least one', () => {
    const limited = (seconds: string) =>
      apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: seconds }]);
    expect(complaintRefusal(limited('31'))).toEqual({
      key: 'student.complaint.refused.rateLimitedIn',
      values: { count: 1 },
    });
    expect(complaintRefusal(limited('3600'))).toEqual({
      key: 'student.complaint.refused.rateLimitedIn',
      values: { count: 60 },
    });
    expect(complaintRefusal(limited('soon'))).toEqual({
      key: 'student.complaint.refused.rateLimited',
    });
  });

  it('names no count of complaints in its words', () => {
    for (const locale of ['ar', 'en'] as const) {
      expect(translate(locale, 'student.complaint.refused.rateLimited')).not.toMatch(/[0-9٠-٩]/);
      expect(
        translate(locale, 'student.complaint.refused.rateLimitedIn', { count: 7 }).replace(
          /7|٧/,
          '',
        ),
      ).not.toMatch(/[0-9٠-٩]/);
    }
  });
});
