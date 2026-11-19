// 003:T112 (SRS FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; the owner's Q-1 (a) of 2026-11-19):
// the postponement on the student's enrollment screen, in Arabic and English. On a confirmed
// enrollment that is not paused, «تأجيل جلسات هذا الأسبوع» opens a sheet saying what it does: the
// coming week's sessions postponed with no consent asked, one too near its start standing, and each
// placed as a make-up (FR-POSTPONE-2); then a mandatory reason, 1 to 500 characters once trimmed,
// sent keyed. Each refusal in plain words; the enrollment read again after. A postponed session's
// row says «مؤجلة» and who postponed it, with the reason (FR-POSTPONE-5).
import type { EnrollmentsGetOutput, ListedSession, MeOutput } from '@ijazah/contracts';
import { PARTICIPANT_REASON_MAX_LENGTH } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { EnrollmentDetail } from './index';

let mockApi = fakeApi();
const mockPostpone = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `postpone-key-${String(++mockKey)}` }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const POSTPONEMENT_ID = '0193a6f0-0000-7000-8000-0000000000f1';
const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد';
const REASON = 'سفر عائلي مفاجئ';

function session(n: number, of: Partial<ListedSession> = {}): ListedSession {
  const day = String(18 + n).padStart(2, '0');
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

const first = session(1);

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
      sessionCount: 2,
      sessionDurationMinutes: 45,
    },
    status: 'confirmed',
    paused: false,
    next: first,
    last: session(2),
    upcoming: 2,
    completed: 0,
    remaining: 2,
    sessions: [first, session(2)],
    complaintOpen: false,
    ijazahRequest: null,
    ...of,
  };
}

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const get = () => mockApi.api.enrollments.get.query;
const button = (direction: Direction, key: MessageKey) =>
  screen.getByRole('button', { name: said(direction, key) });
const conflict = (cause: string) => apiError('CONFLICT', [{ path: 'cause', code: cause }]);

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <EnrollmentDetail />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockPostpone.mockReset();
  mockKey = 0;
  Object.assign(mockApi.api, { sessions: { postpone: { mutate: mockPostpone } } });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

async function openSheet(direction: Direction): Promise<void> {
  expect(await screen.findByText(TEACHER)).toBeTruthy();
  await fireEvent.press(button(direction, 'postponement.action'));
}

async function writeReason(direction: Direction, text: string): Promise<void> {
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, 'postponement.form.reason')),
    text,
  );
}

describe('EnrollmentDetail: the postponement offered (T112, FR-POSTPONE-1, FR-POSTPONE-2)', () => {
  it('opens a sheet saying the week is postponed and each session placed as a make-up', async () => {
    get().mockResolvedValue(detail());
    await inBothDirections(ui, async (_rendered, direction) => {
      await openSheet(direction);
      expect(screen.getByText(said(direction, 'postponement.sheet.week'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'postponement.sheet.near'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'postponement.sheet.makeup'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'postponement.form.hint'))).toBeTruthy();
    });
  });

  it('is not offered on a paused enrollment, nor on one that is not confirmed', async () => {
    for (const of of [{ paused: true }, { status: 'cancelled' as const }]) {
      get().mockResolvedValue(detail(of));
      await renderIn('rtl', ui());
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.queryByText(said('rtl', 'postponement.action'))).toBeNull();
      await cleanup();
    }
  });
});

describe('EnrollmentDetail: the reason (T112, FR-POSTPONE-1: mandatory, 1 to 500)', () => {
  it('sends nothing while the reason is blank or longer than 500 characters once trimmed', async () => {
    get().mockResolvedValue(detail());
    await inBothDirections(ui, async (_rendered, direction) => {
      await openSheet(direction);
      const send = () => button(direction, 'postponement.form.send');
      await writeReason(direction, '   ');
      await fireEvent.press(send());
      await writeReason(direction, ` ${'ع'.repeat(PARTICIPANT_REASON_MAX_LENGTH + 1)} `);
      expect(screen.getByText(said(direction, 'postponement.form.tooLong'))).toBeTruthy();
      await fireEvent.press(send());
      expect(mockPostpone).not.toHaveBeenCalled();
      await writeReason(direction, ` ${'ع'.repeat(PARTICIPANT_REASON_MAX_LENGTH)} `);
      expect(screen.queryByText(said(direction, 'postponement.form.tooLong'))).toBeNull();
    });
  });

  it('sends the trimmed reason keyed, the same key on a retry, then reads the enrollment again and closes', async () => {
    get().mockResolvedValue(detail());
    mockPostpone
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ postponementId: POSTPONEMENT_ID, sessionIds: [first.sessionId] });
    await renderIn('rtl', ui());
    await openSheet('rtl');
    await writeReason('rtl', `  ${REASON}  `);
    await fireEvent.press(button('rtl', 'postponement.form.send'));
    expect(await screen.findByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    const reads = get().mock.calls.length;
    await fireEvent.press(button('rtl', 'postponement.form.send'));
    await waitFor(() => expect(get().mock.calls.length).toBeGreaterThan(reads));
    expect(mockPostpone.mock.calls.map(([input]) => input)).toEqual([
      { enrollmentId: ENROLLMENT_ID, reason: REASON, idempotencyKey: 'postpone-key-1' },
      { enrollmentId: ENROLLMENT_ID, reason: REASON, idempotencyKey: 'postpone-key-1' },
    ]);
    await waitFor(() =>
      expect(screen.queryByText(said('rtl', 'postponement.sheet.week'))).toBeNull(),
    );
  });
});

describe('EnrollmentDetail: each refusal in plain words (T112, FR-POSTPONE-3, FR-POSTPONE-4)', () => {
  const refusals: readonly [string, () => Error, MessageKey][] = [
    [
      'no_session_in_week',
      () => conflict('no_session_in_week'),
      'postponement.refused.noSessionInWeek',
    ],
    [
      'interval_not_passed',
      () => conflict('interval_not_passed'),
      'postponement.refused.intervalNotPassed',
    ],
    [
      'enrollment_not_confirmed',
      () => conflict('enrollment_not_confirmed'),
      'postponement.refused.enrollmentNotConfirmed',
    ],
    [
      'ACCOUNT_RESTRICTED',
      () => apiError('ACCOUNT_RESTRICTED'),
      'postponement.refused.accountRestricted',
    ],
  ];

  it.each(refusals)('says the refusal %s in its own words', async (_name, refusal, key) => {
    get().mockResolvedValue(detail());
    mockPostpone.mockImplementation(() => Promise.reject(refusal()));
    await inBothDirections(ui, async (_rendered, direction) => {
      await openSheet(direction);
      await writeReason(direction, REASON);
      await fireEvent.press(button(direction, 'postponement.form.send'));
      expect(await screen.findByText(said(direction, key))).toBeTruthy();
    });
  });
});

describe('EnrollmentDetail: a postponed session shown (T112, FR-POSTPONE-5)', () => {
  it('says «مؤجلة» on the row, with who postponed it and the reason', async () => {
    const byTeacher = session(1, {
      status: 'postponed',
      postponement: { by: 'teacher', reason: 'سفر الشيخ', at: '2026-11-18T09:00:00.000Z' },
    });
    const byMe = session(2, {
      status: 'postponed',
      postponement: { by: 'student', reason: REASON, at: '2026-11-18T09:00:00.000Z' },
    });
    get().mockResolvedValue(detail({ sessions: [byTeacher, byMe] }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.getAllByText(said(direction, 'status.session.postponed'))).toHaveLength(2);
      expect(
        screen.getByText(said(direction, 'postponement.shown.byTeacher', { reason: 'سفر الشيخ' })),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'postponement.shown.byMe', { reason: REASON })),
      ).toBeTruthy();
    });
  });
});
