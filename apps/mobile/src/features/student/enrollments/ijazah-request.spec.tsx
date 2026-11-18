// T020 of specs/005-certification (FR-602, FR-605, FR-607, FR-608; R-HONEST-6): the ijazah request on
// the student's enrollment screen, in Arabic and English. Awaiting the student's name: «بانتظار
// اسمك» and the name's sheet, the name shown as it will print, saved once through
// `account.certificateName.set` (keyed), the enrollment read again; `already_set` and a refused name
// said in place. Pending: «قيد المراجعة». Issued: «صدرت» and the certificate opened through its
// signed link, or «قيد الإعداد» until it is signed off. Revoked: «مسحوبة», never opened. A rejected
// or closed request shows nothing to the student, and no reason anywhere.
import type {
  CertificateItem,
  EnrollmentsGetOutput,
  ListedSession,
  MeOutput,
} from '@ijazah/contracts';
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
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));
const mockOpenBrowser = jest.fn(async (_url: string) => ({ type: 'opened' }));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (url: string) => mockOpenBrowser(url),
}));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `name-key-${++mockKey}` }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const IJAZAH_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد';
const LINK = 'https://files.ijazah.test/ijazahs/c1.pdf?signature=1';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };

const first: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-19',
  startTimeLocal: '20:00',
  timezone: CAIRO,
  startsAt: '2026-11-19T18:00:00.000Z',
  endsAt: '2026-11-19T18:45:00.000Z',
  status: 'done',
  pendingCancellation: false,
  disputed: false,
};

function detail(ijazahRequest: EnrollmentsGetOutput['ijazahRequest']): EnrollmentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    teacher: {
      teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
      displayName: TEACHER,
      displayNameOrNull: TEACHER,
      deleted: false,
    },
    summary: { subject: QURAN, track: 'ijazah_track', sessionCount: 1, sessionDurationMinutes: 45 },
    status: 'completed',
    paused: false,
    last: first,
    upcoming: 0,
    completed: 1,
    remaining: 0,
    sessions: [first],
    complaintOpen: false,
    ijazahRequest,
  };
}

function certificate(of: Partial<CertificateItem> = {}): CertificateItem {
  return {
    ijazahId: IJAZAH_ID,
    subject: QURAN,
    teacherName: TEACHER,
    issuedAt: '2026-11-20T10:00:00.000Z',
    revoked: false,
    ready: true,
    ...of,
  };
}

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey) => translate('ar', key);
const get = () => mockApi.api.enrollments.get.query;
const setName = jest.fn<(input: unknown) => Promise<unknown>>();
const list = jest.fn<(input?: unknown) => Promise<unknown>>();
const link = jest.fn<(input: unknown) => Promise<unknown>>();

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <EnrollmentDetail />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockKey = 0;
  setName.mockReset();
  list.mockReset();
  link.mockReset();
  mockOpenBrowser.mockClear();
  Object.assign(mockApi.api.account, {
    certificateName: { set: { mutate: setName } },
    pushToken: { register: { mutate: jest.fn(async () => undefined) } },
  });
  Object.assign(mockApi.api, {
    certificates: { list: { query: list }, link: { query: link } },
  });
  list.mockResolvedValue({ items: [certificate()] });
  link.mockResolvedValue({ link: LINK });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

const loaded = async () => expect(await screen.findByText(TEACHER)).toBeTruthy();

describe('EnrollmentDetail: the ijazah request (T020, FR-608)', () => {
  it('awaiting the student’s name: «بانتظار اسمك», what the teacher asked, and the name’s button', async () => {
    get().mockResolvedValue(detail({ status: 'awaiting_student_name' }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await loaded();
      expect(screen.getByText(said(direction, 'student.ijazahRequest.awaitingName'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'student.ijazahRequest.awaitingNameText')),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: said(direction, 'student.ijazahRequest.enterName') }),
      ).toBeTruthy();
    });
  });

  it('pending: «قيد المراجعة», and no name asked', async () => {
    get().mockResolvedValue(detail({ status: 'pending' }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await loaded();
      expect(screen.getByText(said(direction, 'status.ijazah.pending'))).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: said(direction, 'student.ijazahRequest.enterName') }),
      ).toBeNull();
    });
  });

  it('issued and signed off: «صدرت», and the certificate opened through its signed link', async () => {
    get().mockResolvedValue(detail({ status: 'approved', ijazahId: IJAZAH_ID }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await loaded();
      expect(await screen.findByText(said(direction, 'status.ijazah.issued'))).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.credentials.view') }),
      );
      await waitFor(() => expect(mockOpenBrowser).toHaveBeenLastCalledWith(LINK));
      expect(link).toHaveBeenLastCalledWith({ ijazahId: IJAZAH_ID });
    });
  });

  it('issued, not yet signed off: «قيد الإعداد», and nothing to open', async () => {
    list.mockResolvedValue({ items: [certificate({ ready: false })] });
    get().mockResolvedValue(detail({ status: 'approved', ijazahId: IJAZAH_ID }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await loaded();
      expect(
        await screen.findByText(said(direction, 'student.credentials.preparing')),
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: said(direction, 'student.credentials.view') }),
      ).toBeNull();
    });
  });

  it('revoked: «مسحوبة», said plainly, never opened, and the certificates not read', async () => {
    get().mockResolvedValue(detail({ status: 'approved', ijazahId: IJAZAH_ID, revoked: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await loaded();
      expect(screen.getByText(said(direction, 'status.ijazah.revoked'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.certificate.revoked.title'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'status.ijazah.issued'))).toBeNull();
      expect(
        screen.queryByRole('button', { name: said(direction, 'student.credentials.view') }),
      ).toBeNull();
    });
    expect(list).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'closed'] as const)('%s: nothing shown to the student', async (status) => {
    get().mockResolvedValue(detail({ status }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await loaded();
      expect(screen.queryByText(said(direction, 'student.certificate.title'))).toBeNull();
      expect(screen.queryByText(said(direction, 'status.ijazah.rejected'))).toBeNull();
    });
  });
});

describe('the certificate-name sheet (T020, FR-602)', () => {
  async function openSheet(direction: Direction): Promise<void> {
    await loaded();
    await fireEvent.press(
      screen.getByRole('button', { name: said(direction, 'student.ijazahRequest.enterName') }),
    );
  }

  it('opens on the request awaiting the name, and shows the name as it will print', async () => {
    get().mockResolvedValue(detail({ status: 'awaiting_student_name' }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await openSheet(direction);
      expect(screen.getByText(said(direction, 'student.certificateName.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.certificateName.hint'))).toBeTruthy();
      await fireEvent.changeText(
        screen.getByLabelText(said(direction, 'student.certificateName.fullName')),
        '  أمل حسن محمود  ',
      );
      expect(screen.getByText(said(direction, 'student.certificateName.preview'))).toBeTruthy();
      expect(screen.getByText('أمل حسن محمود')).toBeTruthy();
    });
  });

  it.each(['rtl', 'ltr'] as const)(
    'sets the name once, keyed, then closes and reads the enrollment again (%s)',
    async (direction) => {
      get().mockResolvedValue(detail({ status: 'awaiting_student_name' }));
      setName.mockResolvedValue({ name: 'أمل حسن محمود' });
      await renderIn(direction, ui());
      await openSheet(direction);
      await fireEvent.changeText(
        screen.getByLabelText(said(direction, 'student.certificateName.fullName')),
        '  أمل حسن محمود  ',
      );
      get().mockResolvedValue(detail({ status: 'pending' }));
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.certificateName.save') }),
      );
      expect(await screen.findByText(said(direction, 'status.ijazah.pending'))).toBeTruthy();
      expect(setName).toHaveBeenCalledTimes(1);
      expect(setName).toHaveBeenCalledWith({
        name: 'أمل حسن محمود',
        idempotencyKey: expect.stringMatching(/^name-key-/),
      });
      expect(screen.queryByText(said(direction, 'student.certificateName.title'))).toBeNull();
    },
  );

  it('says `already_set` in place, and the sheet stays', async () => {
    get().mockResolvedValue(detail({ status: 'awaiting_student_name' }));
    setName.mockRejectedValue(
      apiError('CONFLICT', [{ path: 'certificateName', code: 'already_set' }]),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await openSheet(direction);
      await fireEvent.changeText(
        screen.getByLabelText(said(direction, 'student.certificateName.fullName')),
        'أمل حسن',
      );
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'student.certificateName.save') }),
      );
      expect(
        await screen.findByText(said(direction, 'student.certificateName.refused.alreadySet')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.certificateName.title'))).toBeTruthy();
    });
  });

  it('says a refused name in place, and the same name sent again keeps its key', async () => {
    get().mockResolvedValue(detail({ status: 'awaiting_student_name' }));
    setName.mockRejectedValue(apiError('VALIDATION_FAILED'));
    await renderIn('rtl', ui());
    await openSheet('rtl');
    await fireEvent.changeText(
      screen.getByLabelText(ar('student.certificateName.fullName')),
      'أمل حسن',
    );
    const save = () =>
      fireEvent.press(screen.getByRole('button', { name: ar('student.certificateName.save') }));
    await save();
    expect(await screen.findByText(ar('student.certificateName.refused.invalid'))).toBeTruthy();
    await save();
    await waitFor(() => expect(setName).toHaveBeenCalledTimes(2));
    const keys = setName.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it('sends nothing for a blank name', async () => {
    get().mockResolvedValue(detail({ status: 'awaiting_student_name' }));
    await renderIn('rtl', ui());
    await openSheet('rtl');
    await fireEvent.changeText(
      screen.getByLabelText(ar('student.certificateName.fullName')),
      '   ',
    );
    await fireEvent.press(screen.getByRole('button', { name: ar('student.certificateName.save') }));
    expect(setName).not.toHaveBeenCalled();
  });
});
