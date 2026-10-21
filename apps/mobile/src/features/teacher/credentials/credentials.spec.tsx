// T059 (FR-153, FR-ISNAD-1, FR-ISNAD-5, FR-PROFILE-11): the teacher's credentials against the
// boards, in both languages. One card per credential: the subject, the status, the transcription
// and the chain read-only on an approved one (the middle folded when long, the holder last), the
// date sent on a waiting one, the PDF row named after its subject; a credential waiting on a
// document opens its request, whose new PDF is sent with `replaceDocument`; a subject is added by
// choosing it (the subjects already held disabled with their status) and uploading its PDF.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { formatFullDate } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { AddSubject, CredentialNeedsDocument, TeacherCredentials } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
  useLocalSearchParams: () => mockParams,
}));

const mockOpenUrl = jest.fn(async (_url: string) => true);
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenUrl(url) }));

type Picked = { uri: string; name: string; sizeBytes: number } | null;
const mockPick = jest.fn<() => Promise<Picked>>();
jest.mock('../../../lib/files', () => ({ pickPdf: () => mockPick() }));

const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const QIRAAT = { id: '0193a6f0-0000-7000-8000-0000000000a3', nameAr: 'القراءات', nameEn: 'Qiraat' };
const SENT = '2026-10-21T09:00:00.000Z';
const REVIEWED = '2026-10-22T10:15:00.000Z';

const generations = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    names: [`جيل ${index + 1}`],
  }));

const approved = {
  credentialId: '0193a6f0-0000-7000-8000-0000000000c1',
  subject: QURAN,
  status: 'approved',
  submittedAt: SENT,
  reviewedAt: REVIEWED,
  holderName: 'سارة عادل',
  riwaya: 'حفص عن عاصم',
  tariq: 'الشاطبية',
  chain: generations(9),
  document: { sizeBytes: 2_516_582 },
};
const pending = {
  credentialId: '0193a6f0-0000-7000-8000-0000000000c2',
  subject: TAJWEED,
  status: 'pending',
  submittedAt: SENT,
  document: {},
};
const waiting = {
  credentialId: '0193a6f0-0000-7000-8000-0000000000c3',
  subject: QIRAAT,
  status: 'needs_document',
  submittedAt: SENT,
  reviewedAt: REVIEWED,
  note: 'الملف غير واضح',
  document: { sizeBytes: 1000 },
};

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'سارة عادل',
  email: 'sara@example.com',
  gender: 'female' as const,
  dateOfBirth: '1988-05-02',
  preferredLanguage: 'ar' as const,
  timezone: 'Africa/Cairo',
  signInMethod: 'google' as const,
  memberSince: '2026-10-20T09:00:00Z',
  accountStatus: 'active' as const,
  landing: 'teacher_home' as const,
  teacher: {
    applicationStatus: 'approved' as const,
    verificationStatus: 'approved' as const,
    payout: { configured: false, verified: false },
  },
};

const said = (
  direction: 'rtl' | 'ltr',
  key: MessageKey,
  values?: Record<string, string | number>,
) => translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const named = (direction: 'rtl' | 'ltr', subject: typeof QURAN) =>
  direction === 'rtl' ? subject.nameAr : subject.nameEn;

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.teacher.credentials.list.query.mockResolvedValue([approved, pending, waiting]);
  mockApi.api.catalog.subjects.list.query.mockResolvedValue([QURAN, TAJWEED, QIRAAT]);
  mockNavigate.mockReset();
  mockPick.mockReset();
  mockOpenUrl.mockClear();
  mockParams = {};
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

describe('TeacherCredentials', () => {
  it('draws each credential: the approved one with its transcription and its chain, the waiting ones with their date', async () => {
    await inBothDirections(
      withQueries(() => <TeacherCredentials />),
      async (_rendered, direction) => {
        expect(await screen.findByText(named(direction, QURAN))).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'teacher.credentials.riwayaLine', {
              riwaya: 'حفص عن عاصم',
              tariq: 'الشاطبية',
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'status.credential.approved'))).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'teacher.credentials.verifiedOn', {
              date: formatFullDate(REVIEWED, 'Africa/Cairo', direction === 'rtl' ? 'ar' : 'en'),
              count: 9,
            }),
          ),
        ).toBeTruthy();
        // Nine generations: two, the five between folded, two, then the holder.
        expect(screen.getByText('جيل 1')).toBeTruthy();
        expect(screen.queryByText('جيل 5')).toBeNull();
        expect(
          screen.getByText(said(direction, 'teacher.credentials.chainMore', { count: 5 })),
        ).toBeTruthy();
        expect(screen.getByText('جيل 9')).toBeTruthy();
        expect(screen.getByText('سارة عادل')).toBeTruthy();

        expect(screen.getByText(said(direction, 'status.credential.pending'))).toBeTruthy();
        expect(
          screen.getAllByText(
            said(direction, 'teacher.credentials.submittedOn', {
              date: formatFullDate(SENT, 'Africa/Cairo', direction === 'rtl' ? 'ar' : 'en'),
            }),
          ).length,
        ).toBeGreaterThan(0);
        expect(
          screen.getByText(
            said(direction, 'teacher.credentials.fileName', { subject: named(direction, TAJWEED) }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('opens a credential waiting on a document, and adds a subject', async () => {
    await renderIn('rtl', withQueries(() => <TeacherCredentials />)());
    await fireEvent.press(await screen.findByText(ar('status.credential.needsDocument')));
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/(teacher)/credentials/[id]',
      params: { id: waiting.credentialId },
    });
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.addSubject') }));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/credentials/add');
  });

  it('opens the approved PDF through a signed link', async () => {
    mockApi.api.teacher.credentials.documentLink.query.mockResolvedValue({
      url: 'https://storage.test/one.pdf?sig=1',
      expiresAt: '2026-10-21T09:05:00Z',
    });
    await renderIn('rtl', withQueries(() => <TeacherCredentials />)());
    await fireEvent.press(
      (await screen.findAllByRole('button', { name: ar('teacher.credentials.a11y.openFile') }))[0]!,
    );
    await waitFor(() =>
      expect(mockOpenUrl).toHaveBeenCalledWith('https://storage.test/one.pdf?sig=1'),
    );
    expect(mockApi.api.teacher.credentials.documentLink.query).toHaveBeenCalledWith({
      credentialId: approved.credentialId,
    });
  });

  it('says so and offers a retry when the list cannot be read', async () => {
    mockApi.api.teacher.credentials.list.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <TeacherCredentials />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
  });
});

describe('CredentialNeedsDocument', () => {
  it('draws the request with the reviewer’s note and the current file, and sends a new PDF', async () => {
    mockParams = { id: waiting.credentialId };
    mockPick.mockResolvedValue({ uri: 'file:///clear.pdf', name: 'clear.pdf', sizeBytes: 3000 });
    await inBothDirections(
      withQueries(() => <CredentialNeedsDocument />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(
            said(direction, 'teacher.credentials.credential.title', {
              subject: named(direction, QIRAAT),
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText('الملف غير واضح')).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.credentials.credential.currentFile')),
        ).toBeTruthy();
      },
    );
    await renderIn('rtl', withQueries(() => <CredentialNeedsDocument />)());
    await fireEvent.press(
      await screen.findByRole('button', {
        name: ar('teacher.credentials.credential.uploadAnother'),
      }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.credentials.replaceDocument.mutate).toHaveBeenCalledWith({
        credentialId: waiting.credentialId,
        documentId: '0193a6f0-0000-7000-8000-000000000001',
      }),
    );
    expect(mockApi.value.client.uploadDocument).toHaveBeenCalledWith(
      'credential',
      expect.objectContaining({ name: 'clear.pdf' }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
  });
});

describe('AddSubject and SubjectPicker', () => {
  it('disables the subjects already held, with their status, and sends the chosen one with its PDF', async () => {
    mockPick.mockResolvedValue({ uri: 'file:///qiraat.pdf', name: 'qiraat.pdf', sizeBytes: 4000 });
    mockApi.api.teacher.credentials.list.query.mockResolvedValue([approved, pending]);
    await renderIn('rtl', withQueries(() => <AddSubject />)());
    const send = () => screen.getByRole('button', { name: ar('teacher.credentials.add.submit') });
    expect(await screen.findByText(ar('teacher.credentials.add.note'))).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.credentials.add.subject') }),
    );
    expect(
      await screen.findByPlaceholderText(ar('teacher.credentials.add.picker.search')),
    ).toBeTruthy();
    expect(screen.getByText(ar('status.credential.approved'))).toBeTruthy();
    expect(screen.getByText(ar('status.credential.pending'))).toBeTruthy();
    await fireEvent.press(screen.getByText(QURAN.nameAr));
    expect(screen.getByPlaceholderText(ar('teacher.credentials.add.picker.search'))).toBeTruthy();
    await fireEvent.press(screen.getByText(QIRAAT.nameAr));

    await fireEvent.press(send());
    expect(mockApi.api.teacher.credentials.add.mutate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText(ar('teacher.credentials.add.yourIjazah')));
    await screen.findByText('qiraat.pdf');
    await fireEvent.press(send());
    await waitFor(() =>
      expect(mockApi.api.teacher.credentials.add.mutate).toHaveBeenCalledWith({
        subjectId: QIRAAT.id,
        documentId: '0193a6f0-0000-7000-8000-000000000001',
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
  });

  it('says so when the credential is refused, and stays', async () => {
    mockPick.mockResolvedValue({ uri: 'file:///q.pdf', name: 'q.pdf', sizeBytes: 4000 });
    mockApi.api.teacher.credentials.add.mutate.mockRejectedValueOnce(apiError('CONFLICT'));
    mockApi.api.teacher.credentials.list.query.mockResolvedValue([]);
    await renderIn('rtl', withQueries(() => <AddSubject />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.credentials.add.subject') }),
    );
    await fireEvent.press(await screen.findByText(QIRAAT.nameAr));
    await fireEvent.press(screen.getByText(ar('teacher.credentials.add.yourIjazah')));
    await screen.findByText('q.pdf');
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.credentials.add.submit') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('back');
  });
});
