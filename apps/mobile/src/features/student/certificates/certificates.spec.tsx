// T020 of specs/005-certification (FR-607; R-HONEST-6): the student's ijazahs tab, in Arabic and
// English. Each ijazah by its subject, the granting teacher's name and the day it was issued in the
// student's zone; a ready one opens through `certificates.link` in the browser; one being prepared
// reads «قيد الإعداد» and a revoked one «مسحوبة», and neither opens. A link refused `revoked` or
// `not_ready` says so and reads the list again. With none, the tab's empty state.
import type { CertificateItem, MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatDate } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { Certificates } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { navigate: (route: unknown) => mockNavigate(route), push: jest.fn(), back: jest.fn() },
}));
const mockOpenBrowser = jest.fn(async (_url: string) => ({ type: 'opened' }));
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (url: string) => mockOpenBrowser(url),
}));

const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد المصري';
const OTHER_TEACHER = 'الشيخ محمود';
const LINK = 'https://files.ijazah.test/ijazahs/c1.pdf?signature=1';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const SHATIBIYYA = {
  id: '0193a6f0-0000-7000-8000-0000000000a3',
  nameAr: 'متن الشاطبية',
  nameEn: 'Shatibiyya',
};

const READY: CertificateItem = {
  ijazahId: '0193a6f0-0000-7000-8000-0000000000c1',
  subject: QURAN,
  teacherName: TEACHER,
  issuedAt: '2026-11-20T10:00:00.000Z',
  revoked: false,
  ready: true,
};
const PREPARING: CertificateItem = {
  ijazahId: '0193a6f0-0000-7000-8000-0000000000c2',
  subject: TAJWEED,
  teacherName: OTHER_TEACHER,
  issuedAt: '2026-11-18T10:00:00.000Z',
  revoked: false,
  ready: false,
};
const REVOKED: CertificateItem = {
  ijazahId: '0193a6f0-0000-7000-8000-0000000000c3',
  subject: SHATIBIYYA,
  teacherName: TEACHER,
  issuedAt: '2026-10-01T10:00:00.000Z',
  revoked: true,
  ready: false,
};

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey) => translate('ar', key);
const list = jest.fn<(input?: unknown) => Promise<unknown>>();
const link = jest.fn<(input: unknown) => Promise<unknown>>();

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <Certificates />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  list.mockReset();
  link.mockReset();
  mockOpenBrowser.mockClear();
  mockNavigate.mockReset();
  Object.assign(mockApi.api, { certificates: { list: { query: list }, link: { query: link } } });
  list.mockResolvedValue({ items: [READY, PREPARING, REVOKED] });
  link.mockResolvedValue({ link: LINK });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('Certificates (T020, FR-607)', () => {
  it('draws each ijazah: ready, being prepared, revoked', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      const subject = (of: typeof QURAN) => (direction === 'rtl' ? of.nameAr : of.nameEn);
      expect(await screen.findByText(subject(QURAN))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.credentials.title'))).toBeTruthy();
      expect(screen.getByText(subject(TAJWEED))).toBeTruthy();
      expect(screen.getByText(subject(SHATIBIYYA))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'student.credentials.teacherIssued', {
            teacher: TEACHER,
            date: formatDate(READY.issuedAt, CAIRO, localeOf(direction)),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.credentials.view'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.credentials.preparing'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.ijazah.revoked'))).toBeTruthy();
      // Only the ready one can be opened.
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });
  });

  it('opens a ready one through its signed link, in the browser', async () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      await renderIn(direction, ui());
      await fireEvent.press(
        await screen.findByRole('button', {
          name: new RegExp(said(direction, 'student.credentials.view')),
        }),
      );
      await waitFor(() => expect(mockOpenBrowser).toHaveBeenLastCalledWith(LINK));
      expect(link).toHaveBeenLastCalledWith({ ijazahId: READY.ijazahId });
      await cleanup();
    }
  });

  it('never opens a revoked one or one being prepared', async () => {
    await renderIn('rtl', ui());
    await fireEvent.press(await screen.findByText(ar('status.ijazah.revoked')));
    await fireEvent.press(screen.getByText(SHATIBIYYA.nameAr));
    await fireEvent.press(screen.getByText(ar('student.credentials.preparing')));
    await fireEvent.press(screen.getByText(TAJWEED.nameAr));
    expect(link).not.toHaveBeenCalled();
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked', 'student.certificate.revoked.title'],
    ['not_ready', 'student.credentials.refused.notReady'],
  ] as const)('a link refused `%s` says so and reads the list again', async (code, key) => {
    link.mockRejectedValue(apiError('CONFLICT', [{ path: 'ijazahId', code }]));
    for (const direction of ['rtl', 'ltr'] as const) {
      list.mockClear();
      await renderIn(direction, ui());
      await fireEvent.press(
        await screen.findByRole('button', {
          name: new RegExp(said(direction, 'student.credentials.view')),
        }),
      );
      expect(await screen.findByText(said(direction, key))).toBeTruthy();
      await waitFor(() => expect(list).toHaveBeenCalled());
      expect(mockOpenBrowser).not.toHaveBeenCalled();
      await cleanup();
    }
  });

  it('with none: the tab’s empty state', async () => {
    list.mockResolvedValue({ items: [] });
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'student.credentials.empty.title')),
      ).toBeTruthy();
    });
  });

  it('a failed read on opening: the retry state', async () => {
    list.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', ui());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
  });
});
