// T058 (FR-150, FR-152, FR-155): the application against the boards, in both languages. The three
// steps (the subjects and the qualification; the identity document; one ijazah per subject, sent
// only when every subject has one), the upload of each PDF as it is picked, the first application
// keyed and a reapplication not; the status in each drawn state (in review with its timeline, a
// document asked for, rejected with the way to reapply, approved once, then the tabs); and the
// resubmission of what a reviewer asked for.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { formatFullDate, formatNumber } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { APPLICATION_QUERY_KEY } from './api';
import { getApplication, startApplication, updateApplication } from './draft';
import {
  ApplicationMoreInfo,
  ApplicationStatus,
  ApplyDocuments,
  ApplyIjazah,
  ApplySubjects,
  ApprovedOnce,
} from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
let mockCanGoBack = false;
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
    canGoBack: () => mockCanGoBack,
  },
  Redirect: ({ href }: { href: string }) => {
    mockNavigate(href);
    return null;
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'apply-0193a6f0-0000-7000-8000' }));

type Picked = { uri: string; name: string; sizeBytes: number } | null;
const mockPick = jest.fn<() => Promise<Picked>>();
jest.mock('../../../lib/files', () => ({ pickPdf: () => mockPick() }));

jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));

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
const SUBMITTED = '2026-10-21T09:00:00.000Z';
const DECIDED = '2026-10-23T12:30:00.000Z';

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
  landing: 'teacher_application' as const,
  teacher: {
    applicationStatus: 'in_review' as const,
    verificationStatus: 'pending' as const,
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

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

const pdf = (name: string, sizeBytes = 2_516_582) => ({ uri: `file:///${name}`, name, sizeBytes });

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.catalog.subjects.list.query.mockResolvedValue([QURAN, TAJWEED]);
  mockApi.api.account.me.query.mockResolvedValue(me);
  mockNavigate.mockReset();
  mockCanGoBack = false;
  mockPick.mockReset();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
  startApplication('submit');
});

describe('ApplySubjects', () => {
  it('draws step 1 of 3, the admin’s subjects as chips and the qualification field', async () => {
    await inBothDirections(
      withQueries(() => <ApplySubjects />),
      async (_rendered, direction) => {
        expect(
          screen.getByText(said(direction, 'teacher.application.subjects.title')),
        ).toBeTruthy();
        expect(
          screen.getAllByText(said(direction, 'teacher.application.steps.subjects')).length,
        ).toBeGreaterThan(0);
        expect(
          await screen.findByText(direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.application.subjects.qualificationLabel')),
        ).toBeTruthy();
      },
    );
  });

  it('goes on only once a subject is chosen and the qualification written', async () => {
    await renderIn('rtl', withQueries(() => <ApplySubjects />)());
    const next = () =>
      screen.getByRole('button', { name: ar('teacher.application.subjects.next') });
    await fireEvent.press(await screen.findByText(QURAN.nameAr));
    await fireEvent.press(next());
    expect(mockNavigate).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByDisplayValue(''), 'إجازة في الحفظ برواية حفص');
    await fireEvent.press(next());
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/documents');
    expect(getApplication()).toMatchObject({
      subjectIds: [QURAN.id],
      qualification: 'إجازة في الحفظ برواية حفص',
    });
  });
});

describe('ApplyDocuments', () => {
  it('uploads the identity PDF as it is picked and shows its name and size', async () => {
    mockPick.mockResolvedValue(pdf('national-id.pdf'));
    await renderIn('rtl', withQueries(() => <ApplyDocuments />)());
    expect(screen.getByText(ar('teacher.application.documents.identityHint'))).toBeTruthy();
    await fireEvent.press(screen.getByText(ar('teacher.application.documents.passport')));
    await fireEvent.press(screen.getByText(ar('teacher.application.documents.identityTitle')));
    expect(await screen.findByText('national-id.pdf')).toBeTruthy();
    expect(
      screen.getByText(ar('common.file.sizeMb', { size: formatNumber(2.4, 'ar') })),
    ).toBeTruthy();
    expect(mockApi.value.client.uploadDocument).toHaveBeenCalledWith(
      'identity',
      expect.objectContaining({ name: 'national-id.pdf' }),
    );
    expect(getApplication()).toMatchObject({ identityType: 'passport' });
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.application.documents.next') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/ijazahs');
  });

  it('waits for the identity PDF, and says so in place when the upload is refused', async () => {
    mockPick.mockResolvedValue(pdf('id.pdf'));
    mockApi.value.client.uploadDocument.mockRejectedValueOnce(apiError('PAYLOAD_TOO_LARGE'));
    await renderIn('rtl', withQueries(() => <ApplyDocuments />)());
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.application.documents.next') }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText(ar('teacher.application.documents.identityTitle')));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(getApplication().identity).toBeUndefined();
  });
});

describe('ApplyIjazah', () => {
  function chooseTwo(mode: 'submit' | 'reapply' = 'submit') {
    startApplication(mode);
    updateApplication({
      subjectIds: [QURAN.id, TAJWEED.id],
      qualification: 'إجازة في الحفظ',
      identity: {
        documentId: '0193a6f0-0000-7000-8000-0000000000d1',
        name: 'id.pdf',
        sizeBytes: 1000,
      },
    });
  }

  it('asks one PDF per subject and sends the application, keyed, only once every subject has one', async () => {
    chooseTwo();
    mockPick.mockResolvedValueOnce(pdf('hifz.pdf')).mockResolvedValueOnce(pdf('tajweed.pdf'));
    await renderIn('rtl', withQueries(() => <ApplyIjazah />)());
    const send = () =>
      screen.getByRole('button', { name: ar('teacher.application.ijazahs.submit') });
    await fireEvent.press(
      await screen.findByText(ar('teacher.application.ijazahs.upload', { subject: QURAN.nameAr })),
    );
    await screen.findByText('hifz.pdf');
    await fireEvent.press(send());
    expect(mockApi.api.teacher.application.submit.mutate).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByText(ar('teacher.application.ijazahs.upload', { subject: TAJWEED.nameAr })),
    );
    await screen.findByText('tajweed.pdf');
    await fireEvent.press(send());
    await waitFor(() =>
      expect(mockApi.api.teacher.application.submit.mutate).toHaveBeenCalledWith({
        subjectIds: [QURAN.id, TAJWEED.id],
        qualificationSummary: 'إجازة في الحفظ',
        identityDocument: {
          type: 'national_id',
          documentId: '0193a6f0-0000-7000-8000-0000000000d1',
        },
        credentials: [
          { subjectId: QURAN.id, documentId: '0193a6f0-0000-7000-8000-000000000001' },
          { subjectId: TAJWEED.id, documentId: '0193a6f0-0000-7000-8000-000000000002' },
        ],
        idempotencyKey: 'apply-0193a6f0-0000-7000-8000',
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/status'));
    expect(getApplication().subjectIds).toEqual([]);
  });

  it('reapplies after a rejection through `reapply`, with no key', async () => {
    chooseTwo('reapply');
    updateApplication({
      ijazahs: {
        [QURAN.id]: {
          documentId: '0193a6f0-0000-7000-8000-0000000000e1',
          name: 'a.pdf',
          sizeBytes: 9,
        },
        [TAJWEED.id]: {
          documentId: '0193a6f0-0000-7000-8000-0000000000e2',
          name: 'b.pdf',
          sizeBytes: 9,
        },
      },
    });
    await renderIn('rtl', withQueries(() => <ApplyIjazah />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.application.ijazahs.submit') }),
    );
    await waitFor(() => expect(mockApi.api.teacher.application.reapply.mutate).toHaveBeenCalled());
    expect(mockApi.api.teacher.application.reapply.mutate.mock.calls[0]?.[0]).not.toHaveProperty(
      'idempotencyKey',
    );
    expect(mockApi.api.teacher.application.submit.mutate).not.toHaveBeenCalled();
  });

  it('keeps the draft and says so when the application is refused', async () => {
    chooseTwo();
    updateApplication({
      ijazahs: {
        [QURAN.id]: {
          documentId: '0193a6f0-0000-7000-8000-0000000000e1',
          name: 'a.pdf',
          sizeBytes: 9,
        },
        [TAJWEED.id]: {
          documentId: '0193a6f0-0000-7000-8000-0000000000e2',
          name: 'b.pdf',
          sizeBytes: 9,
        },
      },
    });
    mockApi.api.teacher.application.submit.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <ApplyIjazah />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.application.ijazahs.submit') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(getApplication().subjectIds).toEqual([QURAN.id, TAJWEED.id]);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('ApplicationStatus (FR-152)', () => {
  function status(answer: Record<string, unknown>) {
    mockApi.api.teacher.application.get.query.mockResolvedValue({
      callRecorded: false,
      approvedShown: false,
      ...answer,
    });
  }
  const dated = (direction: 'rtl' | 'ltr', instant: string) =>
    formatFullDate(instant, 'Africa/Cairo', direction === 'rtl' ? 'ar' : 'en');

  it('draws in review: received, and the timeline with the submission and the subject count', async () => {
    status({ status: 'in_review', submittedAt: SUBMITTED, subjectCount: 2 });
    await inBothDirections(
      withQueries(() => <ApplicationStatus />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.application.status.receivedTitle')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'status.application.pending'))).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'teacher.application.status.timeline.submittedMeta', {
              date: dated(direction, SUBMITTED),
              count: 2,
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.application.status.timeline.call')),
        ).toBeTruthy();
      },
    );
  });

  it('shows a document asked for as a card that opens the request', async () => {
    status({
      status: 'needs_document',
      submittedAt: SUBMITTED,
      subjectCount: 2,
      note: 'نسخة أوضح',
      decidedAt: DECIDED,
    });
    await renderIn('rtl', withQueries(() => <ApplicationStatus />)());
    await fireEvent.press(await screen.findByText(ar('teacher.application.status.moreInfoCard')));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/more-info');
  });

  it('draws rejected with the reviewer’s note and its date, and starts a reapplication', async () => {
    status({
      status: 'rejected',
      submittedAt: SUBMITTED,
      subjectCount: 2,
      note: 'الوثائق لا تطابق الاسم',
      decidedAt: DECIDED,
    });
    await inBothDirections(
      withQueries(() => <ApplicationStatus />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.application.rejected.heading')),
        ).toBeTruthy();
        expect(screen.getByText('الوثائق لا تطابق الاسم')).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'common.reviewTeam.fromOn', { date: dated(direction, DECIDED) }),
          ),
        ).toBeTruthy();
      },
    );
    await renderIn('rtl', withQueries(() => <ApplicationStatus />)());
    await fireEvent.press(await screen.findByText(ar('teacher.application.rejected.applyAgain')));
    expect(getApplication().mode).toBe('reapply');
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/subjects');
  });

  it('draws approved once: the three next steps, the packages tab linked, «متابعة» marks it shown and opens the tabs', async () => {
    status({
      status: 'approved',
      submittedAt: SUBMITTED,
      subjectCount: 2,
      callRecorded: true,
      decidedAt: DECIDED,
    });
    await inBothDirections(
      withQueries(() => <ApplicationStatus />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.application.approved.title')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.application.approved.payout')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.application.approved.profile')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.application.approved.packages')),
        ).toBeTruthy();
        // The drawn buttons wait for their screens (B15, Phase 2): one «متابعة» stands for them.
        expect(
          screen.queryByText(said(direction, 'teacher.application.approved.setupPayout')),
        ).toBeNull();
        expect(
          screen.queryByText(said(direction, 'teacher.application.approved.profileFirst')),
        ).toBeNull();
      },
    );
    await renderIn('rtl', withQueries(() => <ApplicationStatus />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('common.action.continue') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.application.markApprovedShown.mutate).toHaveBeenCalled(),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)'));

    mockNavigate.mockReset();
    await renderIn('rtl', withQueries(() => <ApplicationStatus />)());
    await fireEvent.press(await screen.findByText(ar('teacher.application.approved.packages')));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/packages'));
    await fireEvent.press(screen.getByText(ar('teacher.application.approved.payout')));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('sends a person with no application to its first step', async () => {
    status({ status: 'not_started' });
    await renderIn('rtl', withQueries(() => <ApplicationStatus />)());
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/subjects'),
    );
  });

  it('says so and offers a retry when the status cannot be read', async () => {
    mockApi.api.teacher.application.get.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <ApplicationStatus />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
  });
});

describe('ApprovedOnce', () => {
  it('opens the approved screen for an approved teacher who has not seen it, and nothing once seen', async () => {
    queries.setQueryData(ME_QUERY_KEY, {
      ...me,
      landing: 'teacher_home',
      teacher: { ...me.teacher, applicationStatus: 'approved', verificationStatus: 'approved' },
    });
    mockApi.api.teacher.application.get.query.mockResolvedValue({
      status: 'approved',
      callRecorded: true,
      approvedShown: false,
    });
    await renderIn('rtl', withQueries(() => <ApprovedOnce />)());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/status'));

    mockNavigate.mockReset();
    mockApi.api.teacher.application.get.query.mockResolvedValue({
      status: 'approved',
      callRecorded: true,
      approvedShown: true,
    });
    queries.setQueryData(APPLICATION_QUERY_KEY, {
      status: 'approved',
      callRecorded: true,
      approvedShown: true,
    });
    await renderIn('rtl', withQueries(() => <ApprovedOnce />)());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('ApplicationMoreInfo (FR-152)', () => {
  const waiting = {
    credentialId: '0193a6f0-0000-7000-8000-0000000000c1',
    subject: QURAN,
    status: 'needs_document',
    submittedAt: SUBMITTED,
    note: 'الملف غير واضح',
    document: { sizeBytes: 1000 },
  };
  const fine = {
    ...waiting,
    credentialId: '0193a6f0-0000-7000-8000-0000000000c2',
    subject: TAJWEED,
    status: 'pending',
    note: undefined,
  };

  beforeEach(() => {
    mockApi.api.teacher.application.get.query.mockResolvedValue({
      status: 'needs_document',
      submittedAt: SUBMITTED,
      subjectCount: 2,
      note: 'نحتاج نسخة أوضح من إجازة الحفظ',
      decidedAt: DECIDED,
      callRecorded: false,
      approvedShown: false,
    });
    mockApi.api.teacher.credentials.list.query.mockResolvedValue([waiting, fine]);
  });

  it('draws the note with its date and one replacement per credential asked for', async () => {
    await inBothDirections(
      withQueries(() => <ApplicationMoreInfo />),
      async (_rendered, direction) => {
        expect(await screen.findByText('نحتاج نسخة أوضح من إجازة الحفظ')).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.application.moreInfo.heading')),
        ).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'teacher.application.ijazahs.upload', {
              subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.queryByText(
            said(direction, 'teacher.application.ijazahs.upload', {
              subject: direction === 'rtl' ? TAJWEED.nameAr : TAJWEED.nameEn,
            }),
          ),
        ).toBeNull();
      },
    );
  });

  it('goes back to the status when the guard opened it with nothing to go back to', async () => {
    await renderIn('rtl', withQueries(() => <ApplicationMoreInfo />)());
    await screen.findByText('نحتاج نسخة أوضح من إجازة الحفظ');
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/status');
  });

  it('goes back the way it came when the status screen pushed it', async () => {
    mockCanGoBack = true;
    await renderIn('rtl', withQueries(() => <ApplicationMoreInfo />)());
    await screen.findByText('نحتاج نسخة أوضح من إجازة الحفظ');
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockNavigate).toHaveBeenCalledWith('back');
    expect(mockNavigate).not.toHaveBeenCalledWith('/(teacher)/application/status');
  });

  it('resubmits once every asked-for PDF is replaced, and returns to the status', async () => {
    mockPick.mockResolvedValue(pdf('hifz-clear.pdf'));
    await renderIn('rtl', withQueries(() => <ApplicationMoreInfo />)());
    const resubmit = () =>
      screen.getByRole('button', { name: ar('teacher.application.moreInfo.resubmit') });
    await screen.findByText('نحتاج نسخة أوضح من إجازة الحفظ');
    await fireEvent.press(resubmit());
    expect(mockApi.api.teacher.application.resubmit.mutate).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByText(ar('teacher.application.ijazahs.upload', { subject: QURAN.nameAr })),
    );
    await screen.findByText('hifz-clear.pdf');
    await fireEvent.press(resubmit());
    await waitFor(() =>
      expect(mockApi.api.teacher.application.resubmit.mutate).toHaveBeenCalledWith({
        credentials: [
          {
            credentialId: waiting.credentialId,
            documentId: '0193a6f0-0000-7000-8000-000000000001',
          },
        ],
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/application/status'));
  });
});
