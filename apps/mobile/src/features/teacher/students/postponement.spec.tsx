// 003:T112 (SRS FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90): the postponement on the teacher's
// enrollment screen, in Arabic and English. On a confirmed enrollment, the same sheet as the
// student's (`shared/postponement`): what it does, a mandatory reason sent keyed, a refusal in plain
// words, the enrollment read again after. A postponed session's row says «مؤجلة» and who postponed
// it, with the reason (FR-POSTPONE-5).
import type { ListedSession, TeacherStudentsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { TeacherEnrollment } from './index';

let mockApi = fakeApi();
const mockPostpone = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `postpone-key-${String(++mockKey)}` }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const POSTPONEMENT_ID = '0193a6f0-0000-7000-8000-0000000000f1';
const CAIRO = 'Africa/Cairo';
const STUDENT = 'يوسف أحمد';
const REASON = 'مرض مفاجئ';

function wednesday(n: number, of: Partial<ListedSession> = {}): ListedSession {
  const date = ['2026-11-18', '2026-11-25', '2026-12-02'][n - 1]!;
  return {
    sessionId: `0193a6f0-0000-7000-8000-0000000005${String(n).padStart(2, '0')}`,
    sequenceNumber: n,
    localDate: date,
    startTimeLocal: '18:00',
    timezone: CAIRO,
    startsAt: `${date}T16:00:00.000Z`,
    endsAt: `${date}T16:45:00.000Z`,
    status: 'scheduled',
    pendingCancellation: false,
    disputed: false,
    ...of,
  };
}

function enrollment(sessions: ListedSession[]): TeacherStudentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: {
      studentId: '0193a6f0-0000-7000-8000-0000000000b9',
      displayName: STUDENT,
      displayNameOrNull: STUDENT,
      deleted: false,
    },
    summary: {
      subject: {
        id: '0193a6f0-0000-7000-8000-0000000000a1',
        nameAr: 'حفظ القرآن',
        nameEn: 'Quran',
      },
      track: 'recitation',
      sessionCount: sessions.length,
      sessionDurationMinutes: 45,
    },
    status: 'confirmed',
    paused: false,
    next: sessions[0],
    last: sessions[sessions.length - 1],
    upcoming: sessions.length,
    completed: 0,
    remaining: sessions.length,
    sessions,
    ijazahRequest: null,
  };
}

const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const get = () => mockApi.api.teacher.students.get.query;
const button = (direction: Direction, key: MessageKey) =>
  screen.getByRole('button', { name: said(direction, key) });

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <TeacherEnrollment />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockPostpone.mockReset();
  mockKey = 0;
  Object.assign(mockApi.api, { sessions: { postpone: { mutate: mockPostpone } } });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, {
    userId: '0193a6f0-0000-7000-8000-000000000002',
    timezone: CAIRO,
  });
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

async function send(direction: Direction, text: string): Promise<void> {
  expect(await screen.findByText(STUDENT)).toBeTruthy();
  await fireEvent.press(button(direction, 'postponement.action'));
  expect(screen.getByText(said(direction, 'postponement.sheet.makeup'))).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, 'postponement.form.reason')),
    text,
  );
  await fireEvent.press(button(direction, 'postponement.form.send'));
}

describe('TeacherEnrollment: the postponement (T112, FR-POSTPONE-1, FR-POSTPONE-2)', () => {
  it('sends the trimmed reason keyed for the enrollment, then reads it again', async () => {
    get().mockResolvedValue(enrollment([wednesday(1), wednesday(2)]));
    mockPostpone.mockResolvedValue({
      postponementId: POSTPONEMENT_ID,
      sessionIds: [wednesday(1).sessionId],
    });
    await renderIn('rtl', ui());
    await send('rtl', `  ${REASON} `);
    await waitFor(() => expect(get()).toHaveBeenCalledTimes(2));
    expect(mockPostpone).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      reason: REASON,
      idempotencyKey: 'postpone-key-1',
    });
  });

  it('says a refusal in plain words: the interval not passed', async () => {
    get().mockResolvedValue(enrollment([wednesday(1)]));
    mockPostpone.mockImplementation(() =>
      Promise.reject(apiError('CONFLICT', [{ path: 'cause', code: 'interval_not_passed' }])),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await send(direction, REASON);
      expect(
        await screen.findByText(said(direction, 'postponement.refused.intervalNotPassed')),
      ).toBeTruthy();
    });
  });
});

describe('TeacherEnrollment: a postponed session shown (T112, FR-POSTPONE-5)', () => {
  it('says «مؤجلة» on its row, with who postponed it and the reason', async () => {
    const byStudent = wednesday(1, {
      status: 'postponed',
      postponement: { by: 'student', reason: 'امتحانات', at: '2026-11-17T09:00:00.000Z' },
    });
    const byMe = wednesday(2, {
      status: 'postponed',
      postponement: { by: 'teacher', reason: REASON, at: '2026-11-17T09:00:00.000Z' },
    });
    get().mockResolvedValue(enrollment([byStudent, byMe, wednesday(3)]));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(STUDENT)).toBeTruthy();
      expect(screen.getAllByText(said(direction, 'status.session.postponed'))).toHaveLength(2);
      expect(
        screen.getByText(said(direction, 'postponement.shown.byStudent', { reason: 'امتحانات' })),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'postponement.shown.byMe', { reason: REASON })),
      ).toBeTruthy();
    });
  });
});
