// 005:T019 (FR-603, FR-608; contracts/app-surface.md, `teacher.ijazahRequests.preview` and `.send`,
// «Enrollment reads gain», «Live event»): the ijazah request on `TeacherEnrollment`, in both
// languages. An ijazah-track enrollment with no request asks for one; the sheet takes the completion
// date (today unless changed) and the certificate's language (Arabic unless chosen), previews the
// certificate as it will be filled, sends it keyed and reads the enrollment again; each refusal of
// FR-603 is said in its own words, a missing signature with the way to upload one. The request's
// status: waiting for the student's name, pending, issued with its certificate (opened by its signed
// link, «being prepared» until signed off), rejected with the reason; a live signal of the enrollment
// reads it again.
import type { TeacherStudentsGetOutput } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatCalendarDate, formatNumber } from '../../../lib/formatters';
import { Rereads } from '../../../lib/live-channel';
import { apiError, fakeApi, type Procedure } from '../../shared/__tests__/api-double';
import { TeacherEnrollment } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const IJAZAH_ID = '0193a6f0-0000-7000-8000-0000000000f1';
const REQUEST_ID = '0193a6f0-0000-7000-8000-0000000000f2';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: (route: unknown) => mockPush(route) },
  useLocalSearchParams: () => ({ enrollmentId: ENROLLMENT_ID }),
}));
const mockOpen = jest.fn<(url: string) => Promise<void>>();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpen(url) }));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `request-key-${String(++mockKey)}` }));
// The teacher's today on the device, fixed: the completion date's default and its latest choice.
const TODAY = '2026-11-18';
jest.mock('@ijazah/time/calendar', () => ({
  ...jest.requireActual<object>('@ijazah/time/calendar'),
  calendarDateOfPicked: () => '2026-11-18',
}));

const CAIRO = 'Africa/Cairo';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};
const SESSION = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-11',
  startTimeLocal: '18:00',
  timezone: CAIRO,
  startsAt: '2026-11-11T16:00:00.000Z',
  endsAt: '2026-11-11T16:45:00.000Z',
  status: 'done' as const,
  pendingCancellation: false,
  disputed: false,
};

function enrollment(of: Partial<TeacherStudentsGetOutput> = {}): TeacherStudentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: { displayName: 'يوسف أحمد', displayNameOrNull: 'يوسف أحمد', deleted: false },
    summary: { subject: QURAN, track: 'ijazah_track', sessionCount: 1, sessionDurationMinutes: 45 },
    status: 'completed',
    paused: false,
    last: SESSION,
    upcoming: 0,
    completed: 1,
    remaining: 0,
    sessions: [SESSION],
    ijazahRequest: null,
    ...of,
  };
}

const PREVIEW = {
  chain: [['عاصم بن أبي النجود'], ['حفص بن سليمان'], ['أحمد سالم']],
  teacherName: 'أحمد سالم',
  riwaya: 'حفص',
  tariq: 'الشاطبية',
  studentName: 'يوسف أحمد علي',
  dates: { completionDate: '2026-11-11', issueDate: '2026-11-18' },
};

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const statusLine = (direction: Direction, word: MessageKey) =>
  said(direction, 'teacher.enrollment.ijazahRequest.status', { status: said(direction, word) });

let queries: QueryClient;
let preview: Procedure;
let send: Procedure;
let link: Procedure;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <TeacherEnrollment />
  </QueryClientProvider>
);
const get = () => mockApi.api.teacher.students.get.query;

beforeEach(() => {
  mockApi = fakeApi();
  preview = jest.fn(async (): Promise<unknown> => PREVIEW);
  send = jest.fn(async (): Promise<unknown> => ({ requestId: REQUEST_ID, status: 'pending' }));
  link = jest.fn(async (): Promise<unknown> => ({ link: 'https://files.ijazah.test/i.pdf?s=1' }));
  Object.assign(mockApi.api.teacher, {
    ijazahRequests: { preview: { query: preview }, send: { mutate: send } },
  });
  Object.assign(mockApi.api, { certificates: { link: { query: link } } });
  mockPush.mockReset();
  mockOpen.mockReset();
  mockOpen.mockResolvedValue(undefined);
  mockKey = 0;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, {
    userId: '0193a6f0-0000-7000-8000-000000000002',
    timezone: CAIRO,
  });
});

/** Opens the sheet from the enrollment and asks for the preview. */
async function openPreview(direction: Direction): Promise<void> {
  await fireEvent.press(
    await screen.findByText(said(direction, 'teacher.enrollment.ijazah.request')),
  );
  await fireEvent.press(screen.getByText(said(direction, 'teacher.ijazahRequest.preview')));
}

describe('the ijazah request on TeacherEnrollment (FR-603)', () => {
  it('asks for the request on an ijazah-track enrollment with none', async () => {
    get().mockResolvedValue(enrollment());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'teacher.enrollment.ijazah.request')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.enrollment.ijazah.title'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.ijazah.prompt', { student: 'يوسف أحمد' }),
        ),
      ).toBeTruthy();
    });
  });

  it.each(['rtl', 'ltr'] as const)(
    'previews the certificate as it will be filled, sends it keyed and reads the enrollment again (%s)',
    async (direction) => {
      const today = TODAY;
      const language = direction === 'rtl' ? 'ar' : 'en';
      get()
        .mockResolvedValueOnce(enrollment())
        .mockResolvedValue(enrollment({ ijazahRequest: { status: 'pending' } }));
      await renderIn(direction, ui());
      await fireEvent.press(
        await screen.findByText(said(direction, 'teacher.enrollment.ijazah.request')),
      );
      expect(screen.getByText(formatCalendarDate(today, localeOf(direction)))).toBeTruthy();
      // Arabic unless chosen (FR-LOC-4): the English run picks English.
      if (language === 'en')
        await fireEvent.press(screen.getByText(said(direction, 'account.languages.en')));
      await fireEvent.press(screen.getByText(said(direction, 'teacher.ijazahRequest.preview')));
      expect(await screen.findByText('حفص بن سليمان')).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.ijazahRequest.riwayaValue', {
            riwaya: 'حفص',
            tariq: 'الشاطبية',
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText('يوسف أحمد علي')).toBeTruthy();
      expect(preview).toHaveBeenCalledWith({
        enrollmentId: ENROLLMENT_ID,
        completionDate: today,
        language,
      });
      await fireEvent.press(screen.getByText(said(direction, 'teacher.ijazahRequest.send')));
      await waitFor(() =>
        expect(send).toHaveBeenCalledWith({
          enrollmentId: ENROLLMENT_ID,
          completionDate: today,
          language,
          idempotencyKey: 'request-key-1',
        }),
      );
      expect(await screen.findByText(statusLine(direction, 'status.ijazah.pending'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.ijazahRequest.send'))).toBeNull();
      expect(get()).toHaveBeenCalledTimes(2);
    },
  );

  it('takes another completion date from the lists', async () => {
    get().mockResolvedValue(enrollment());
    await renderIn('rtl', ui());
    await fireEvent.press(
      await screen.findByText(said('rtl', 'teacher.enrollment.ijazah.request')),
    );
    await fireEvent.press(screen.getByText(formatCalendarDate(TODAY, 'ar')));
    // The lists start at the first session's day: the 11th, the last match being the sheet's.
    await fireEvent.press(screen.getAllByText(formatNumber(11, 'ar')).at(-1)!);
    await fireEvent.press(screen.getByText(said('rtl', 'common.action.done')));
    await fireEvent.press(screen.getByText(said('rtl', 'teacher.ijazahRequest.preview')));
    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith({
        enrollmentId: ENROLLMENT_ID,
        completionDate: '2026-11-11',
        language: 'ar',
      }),
    );
  });

  it.each([
    ['CONFLICT', 'not_active', 'teacher.ijazahRequest.refused.notActive'],
    ['CONFLICT', 'not_ijazah_track', 'teacher.ijazahRequest.refused.notIjazahTrack'],
    ['CONFLICT', 'no_credential', 'teacher.ijazahRequest.refused.noCredential'],
    ['CONFLICT', 'student_barred', 'teacher.ijazahRequest.refused.studentBarred'],
    ['CONFLICT', 'request_open', 'teacher.ijazahRequest.refused.requestOpen'],
    ['CONFLICT', 'already_issued', 'teacher.ijazahRequest.refused.alreadyIssued'],
    ['VALIDATION_FAILED', 'in_future', 'teacher.ijazahRequest.refused.inFuture'],
  ] as const)('says the send refused %s %s in its own words', async (code, reason, key) => {
    get().mockResolvedValue(enrollment());
    send.mockRejectedValue(
      apiError(code, [
        { path: code === 'CONFLICT' ? 'enrollmentId' : 'completionDate', code: reason },
      ]),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await openPreview(direction);
      await fireEvent.press(await screen.findByText(said(direction, 'teacher.ijazahRequest.send')));
      expect(await screen.findByText(said(direction, key))).toBeTruthy();
    });
  });

  it('says a preview refused in its own words', async () => {
    get().mockResolvedValue(enrollment());
    preview.mockRejectedValue(
      apiError('CONFLICT', [{ path: 'enrollmentId', code: 'no_credential' }]),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await openPreview(direction);
      expect(
        await screen.findByText(said(direction, 'teacher.ijazahRequest.refused.noCredential')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.ijazahRequest.send'))).toBeNull();
    });
  });

  it('says a missing signature with the way to upload one', async () => {
    get().mockResolvedValue(enrollment());
    send.mockRejectedValue(apiError('CONFLICT', [{ path: 'enrollmentId', code: 'no_signature' }]));
    await inBothDirections(ui, async (_rendered, direction) => {
      await openPreview(direction);
      await fireEvent.press(await screen.findByText(said(direction, 'teacher.ijazahRequest.send')));
      expect(
        await screen.findByText(said(direction, 'teacher.ijazahRequest.blocked.title')),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.ijazahRequest.blocked.text', { student: 'يوسف أحمد' }),
        ),
      ).toBeTruthy();
      mockPush.mockClear();
      await fireEvent.press(
        screen.getByText(said(direction, 'teacher.ijazahRequest.blocked.upload')),
      );
      expect(mockPush).toHaveBeenCalledWith('/(teacher)/account/signature');
    });
  });
});

describe('the ijazah request’s status on TeacherEnrollment (FR-608)', () => {
  it.each([
    ['awaiting_student_name', 'teacher.enrollment.ijazahRequest.awaitingName'],
    ['pending', 'status.ijazah.pending'],
  ] as const)('draws a request %s with its status, and no new request', async (status, word) => {
    get().mockResolvedValue(enrollment({ ijazahRequest: { status } }));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(statusLine(direction, word))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.enrollment.ijazah.request'))).toBeNull();
    });
  });

  it('draws an issued request with its certificate, opened by its signed link', async () => {
    get().mockResolvedValue(
      enrollment({ ijazahRequest: { status: 'approved', ijazahId: IJAZAH_ID } }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(statusLine(direction, 'status.ijazah.issued'))).toBeTruthy();
      mockOpen.mockClear();
      await fireEvent.press(screen.getByText(said(direction, 'teacher.enrollment.ijazah.view')));
      await waitFor(() =>
        expect(mockOpen).toHaveBeenCalledWith('https://files.ijazah.test/i.pdf?s=1'),
      );
    });
    expect(link).toHaveBeenCalledWith({ ijazahId: IJAZAH_ID });
  });

  it('says an issued certificate not yet signed off is being prepared', async () => {
    get().mockResolvedValue(
      enrollment({ ijazahRequest: { status: 'approved', ijazahId: IJAZAH_ID } }),
    );
    link.mockRejectedValue(apiError('CONFLICT', [{ path: 'ijazahId', code: 'not_ready' }]));
    await inBothDirections(ui, async (_rendered, direction) => {
      await fireEvent.press(
        await screen.findByText(said(direction, 'teacher.enrollment.ijazah.view')),
      );
      expect(
        await screen.findByText(said(direction, 'teacher.enrollment.ijazahRequest.preparing')),
      ).toBeTruthy();
      expect(mockOpen).not.toHaveBeenCalled();
    });
  });

  it('draws a rejected request with its reason, and asks for a new one', async () => {
    get().mockResolvedValue(
      enrollment({ ijazahRequest: { status: 'rejected', reason: 'السند ناقص جيلًا' } }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(statusLine(direction, 'status.ijazah.rejected'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'teacher.enrollment.ijazahRequest.rejectedReason', {
            reason: 'السند ناقص جيلًا',
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.enrollment.ijazah.request'))).toBeTruthy();
    });
  });

  it('reads the enrollment again on a live signal and draws the new status', async () => {
    get()
      .mockResolvedValueOnce(enrollment({ ijazahRequest: { status: 'awaiting_student_name' } }))
      .mockResolvedValue(enrollment({ ijazahRequest: { status: 'pending' } }));
    await renderIn('rtl', ui());
    expect(
      await screen.findByText(statusLine('rtl', 'teacher.enrollment.ijazahRequest.awaitingName')),
    ).toBeTruthy();
    const rereads = new Rereads(queries);
    await act(async () => {
      rereads.signal({ type: 'enrollment', enrollmentId: ENROLLMENT_ID });
    });
    expect(await screen.findByText(statusLine('rtl', 'status.ijazah.pending'))).toBeTruthy();
    expect(get()).toHaveBeenCalledTimes(2);
    rereads.dispose();
  });
});
