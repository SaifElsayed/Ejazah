// T074 (FR-137, FR-145, FR-166): the restricted screen and the identity request, against the boards,
// in both languages. A suspended or banned account sees its role's screen (`AccountRestricted`,
// `TeacherRestricted`), the banned title without the review line; «تواصل مع الدعم» writes to the
// support address of the public configuration; «تسجيل الخروج» opens the sheet. `VerifyIdentity`
// takes the document's type and its one PDF, sends it to the open request, and then says it waits
// for review; the card on a home opens it while the account is under a request.
//
// T097 (FR-155): a sign-up refused because the identifiers belong to a banned person's deleted
// account lands on `BannedSignedOut`, with no session: the banned title and the final line, the
// support contact, and the way back to the start; nothing on it says an account was deleted.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { apiError, fakeApi } from '../__tests__/api-double';
import { getSession, setSession } from '../../../lib/session';
import { BannedSignedOut, IdentityRequestCard, Restricted, VerifyIdentity } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
    canGoBack: () => mockCanGoBack,
  },
}));

const mockOpen = jest.fn<(url: string) => Promise<true>>();
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpen(url) }));

type Picked = { uri: string; name: string; sizeBytes: number } | null;
const mockPick = jest.fn<() => Promise<Picked>>();
jest.mock('../../../lib/files', () => ({ pickPdf: () => mockPick() }));

type Standing = 'active' | 'suspended' | 'verification_required' | 'banned';

function accountOf(role: 'student' | 'teacher', accountStatus: Standing) {
  const restricted = accountStatus === 'suspended' || accountStatus === 'banned';
  return {
    userId: '0193a6f0-0000-7000-8000-000000000002',
    role,
    displayName: 'سارة عادل',
    email: 'sara@example.com',
    gender: 'female' as const,
    dateOfBirth: '1990-05-02',
    preferredLanguage: 'ar' as const,
    timezone: 'Africa/Cairo',
    signInMethod: 'google' as const,
    memberSince: '2026-10-20T09:00:00Z',
    accountStatus,
    landing: restricted ? 'restricted' : role === 'student' ? 'student_home' : 'teacher_home',
    ...(role === 'teacher'
      ? {
          teacher: {
            applicationStatus: 'approved' as const,
            verificationStatus: 'approved' as const,
            payout: { configured: false, verified: false },
          },
        }
      : {}),
  };
}

const said = (direction: 'rtl' | 'ltr', key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);
const ar = (key: MessageKey) => translate('ar', key);

let queries: QueryClient;
function as(role: 'student' | 'teacher', standing: Standing, ui: () => ReactElement) {
  return () => {
    queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queries.setQueryData(ME_QUERY_KEY, accountOf(role, standing));
    return <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>;
  };
}

const pdf = (name: string) => ({ uri: `file:///${name}`, name, sizeBytes: 812_000 });
const REQUESTED = '2026-10-22T09:00:00.000Z';

beforeEach(() => {
  mockApi = fakeApi();
  mockNavigate.mockReset();
  mockOpen.mockReset();
  mockOpen.mockResolvedValue(true);
  mockPick.mockReset();
  mockCanGoBack = true;
});

describe('Restricted (FR-137)', () => {
  it('draws a suspended student: the lock, the review line, what stopped and what stays', async () => {
    await inBothDirections(
      as('student', 'suspended', () => <Restricted />),
      (_rendered, direction) => {
        for (const key of [
          'account.restricted.title',
          'account.restricted.lede',
          'account.restricted.stopped',
          'account.restricted.stoppedItems.booking',
          'account.restricted.stoppedItems.chat',
          'account.restricted.available',
          'account.restricted.availableItems.ijazahs',
          'account.restricted.availableItems.support',
        ] as const) {
          expect(screen.getByText(said(direction, key))).toBeTruthy();
        }
        expect(
          screen.getByRole('button', {
            name: said(direction, 'account.restricted.contactSupport'),
          }),
        ).toBeTruthy();
        expect(
          screen.getByRole('button', { name: said(direction, 'account.restricted.signOut') }),
        ).toBeTruthy();
      },
    );
  });

  it('draws a banned student with the banned title and without the review line', async () => {
    await inBothDirections(
      as('student', 'banned', () => <Restricted />),
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'account.restricted.bannedTitle'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'account.restricted.finalLede'))).toBeTruthy();
        expect(screen.queryByText(said(direction, 'account.restricted.title'))).toBeNull();
        expect(screen.queryByText(said(direction, 'account.restricted.lede'))).toBeNull();
      },
    );
  });

  it("draws a suspended teacher's screen: the teacher's lines of what stopped and what stays", async () => {
    await inBothDirections(
      as('teacher', 'suspended', () => <Restricted />),
      (_rendered, direction) => {
        for (const key of [
          'teacher.restricted.title',
          'teacher.restricted.lede',
          'teacher.restricted.stoppedTitle',
          'teacher.restricted.stoppedDiscovery',
          'teacher.restricted.stoppedSessions',
          'teacher.restricted.stoppedUpcoming',
          'teacher.restricted.availableTitle',
          'teacher.restricted.availableIjazahs',
          'teacher.restricted.availableSupport',
        ] as const) {
          expect(screen.getByText(said(direction, key))).toBeTruthy();
        }
        expect(
          screen.queryByText(said(direction, 'account.restricted.stoppedItems.chat')),
        ).toBeNull();
      },
    );
  });

  it('draws a banned teacher with the banned title and without the review line', async () => {
    await inBothDirections(
      as('teacher', 'banned', () => <Restricted />),
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'teacher.restricted.bannedTitle'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.restricted.finalLede'))).toBeTruthy();
        expect(screen.queryByText(said(direction, 'teacher.restricted.title'))).toBeNull();
        expect(screen.queryByText(said(direction, 'teacher.restricted.lede'))).toBeNull();
      },
    );
  });

  it('writes to the support address of the public configuration (FR-145)', async () => {
    await renderIn('rtl', as('student', 'suspended', () => <Restricted />)());
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.restricted.contactSupport') }),
    );
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('mailto:support@ijazah.test'));
  });

  it('says so in place when the support address cannot be read', async () => {
    mockApi.value.client.publicConfig.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', as('teacher', 'banned', () => <Restricted />)());
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.restricted.contactSupport') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('opens the sign-out sheet', async () => {
    await renderIn('rtl', as('student', 'banned', () => <Restricted />)());
    await fireEvent.press(screen.getByRole('button', { name: ar('account.restricted.signOut') }));
    expect(await screen.findByText(ar('account.signOutSheet.title'))).toBeTruthy();
  });
});

describe('BannedSignedOut (T097, FR-155)', () => {
  beforeEach(() => setSession({ kind: 'signed-out' }));

  it('draws the banned title, the final line, the support contact and the way back', async () => {
    await inBothDirections(
      () => <BannedSignedOut />,
      (rendered, direction) => {
        expect(screen.getByText(said(direction, 'account.restricted.bannedTitle'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'account.restricted.finalLede'))).toBeTruthy();
        expect(
          screen.getByRole('button', {
            name: said(direction, 'account.restricted.contactSupport'),
          }),
        ).toBeTruthy();
        expect(
          screen.getByRole('button', { name: said(direction, 'auth.banned.backToStart') }),
        ).toBeTruthy();
        // Signed out: no sign-out, no role's lines, and no word of a deleted account.
        expect(
          screen.queryByRole('button', { name: said(direction, 'account.restricted.signOut') }),
        ).toBeNull();
        expect(screen.queryByText(said(direction, 'account.restricted.stopped'))).toBeNull();
        expect(JSON.stringify(rendered.toJSON())).not.toMatch(/حذف|حُذف|delet/i);
      },
    );
  });

  it('writes to the support address of the cached public configuration', async () => {
    await renderIn('rtl', <BannedSignedOut />);
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.restricted.contactSupport') }),
    );
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('mailto:support@ijazah.test'));
    expect(mockApi.value.client.publicConfig).toHaveBeenCalledTimes(1);
    expect(mockApi.api.account.me.query).not.toHaveBeenCalled();
  });

  it('says so in place when the support address cannot be read', async () => {
    mockApi.value.client.publicConfig.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', <BannedSignedOut />);
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.restricted.contactSupport') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('goes back to the signed-out start, storing nothing', async () => {
    await renderIn('rtl', <BannedSignedOut />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.banned.backToStart') }));
    expect(mockNavigate).toHaveBeenCalledWith('/(auth)/welcome');
    expect(getSession()).toEqual({ kind: 'signed-out' });
    expect(mockApi.sessions.current()).toBeNull();
  });
});

describe('VerifyIdentity (FR-166)', () => {
  function request(answer: Record<string, unknown>) {
    mockApi.api.account.identityVerification.get.query.mockResolvedValue(answer);
  }
  const open = { open: true, reason: 'بلاغ من معلمة', requestedAt: REQUESTED };

  it("draws a student's request: the booking line, the reason, the type and the upload", async () => {
    request(open);
    await inBothDirections(
      as('student', 'verification_required', () => <VerifyIdentity />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'account.verifyIdentity.intro')),
        ).toBeTruthy();
        for (const key of [
          'account.verifyIdentity.title',
          'account.verifyIdentity.banner.strong',
          'account.verifyIdentity.banner.text',
          'account.verifyIdentity.reasonTitle',
          'account.verifyIdentity.docType',
          'account.verifyIdentity.docTypes.nationalId',
          'account.verifyIdentity.docTypes.passport',
          'account.verifyIdentity.upload.nationalId',
          'account.verifyIdentity.upload.nationalIdHint',
          'account.verifyIdentity.tip',
        ] as const) {
          expect(screen.getByText(said(direction, key))).toBeTruthy();
        }
        expect(screen.getByText('بلاغ من معلمة')).toBeTruthy();
      },
    );
  });

  it("draws a teacher's request without the booking line, which is a student's", async () => {
    request(open);
    await renderIn('rtl', as('teacher', 'verification_required', () => <VerifyIdentity />)());
    expect(await screen.findByText(ar('account.verifyIdentity.intro'))).toBeTruthy();
    expect(screen.queryByText(ar('account.verifyIdentity.banner.strong'))).toBeNull();
  });

  it('uploads the national ID as it is picked, sends it, and then says it waits for review', async () => {
    request(open);
    mockPick.mockResolvedValue(pdf('id.pdf'));
    await renderIn('rtl', as('student', 'verification_required', () => <VerifyIdentity />)());
    const send = await screen.findByRole('button', { name: ar('account.verifyIdentity.submit') });
    expect(send.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByText(ar('account.verifyIdentity.upload.nationalId')));
    expect(await screen.findByText('id.pdf')).toBeTruthy();
    expect(mockApi.value.client.uploadDocument).toHaveBeenCalledWith(
      'identity',
      expect.objectContaining({ name: 'id.pdf' }),
    );
    request({ ...open, documentType: 'national_id', submittedAt: REQUESTED });
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.verifyIdentity.submit') }),
    );
    await waitFor(() =>
      expect(mockApi.api.account.identityVerification.submit.mutate).toHaveBeenCalledWith({
        documentType: 'national_id',
        documentId: '0193a6f0-0000-7000-8000-000000000001',
      }),
    );
    expect(await screen.findByText(ar('account.verifyIdentity.submitted.title'))).toBeTruthy();
  });

  it('switches to the passport in place and sends it as one', async () => {
    request(open);
    mockPick.mockResolvedValue(pdf('passport.pdf'));
    await renderIn('rtl', as('teacher', 'verification_required', () => <VerifyIdentity />)());
    await fireEvent.press(await screen.findByText(ar('account.verifyIdentity.docTypes.passport')));
    expect(screen.getByText(ar('account.verifyIdentity.upload.passportHint'))).toBeTruthy();
    expect(screen.queryByText(ar('account.verifyIdentity.upload.nationalId'))).toBeNull();
    await fireEvent.press(screen.getByText(ar('account.verifyIdentity.upload.passport')));
    expect(await screen.findByText('passport.pdf')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.verifyIdentity.submit') }),
    );
    await waitFor(() =>
      expect(mockApi.api.account.identityVerification.submit.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ documentType: 'passport' }),
      ),
    );
  });

  it('says a sent document waits for review, with nothing to send again', async () => {
    request({ ...open, documentType: 'passport', submittedAt: REQUESTED });
    await inBothDirections(
      as('student', 'verification_required', () => <VerifyIdentity />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'account.verifyIdentity.submitted.title')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'account.verifyIdentity.submitted.text')),
        ).toBeTruthy();
        expect(
          screen.queryByRole('button', { name: said(direction, 'account.verifyIdentity.submit') }),
        ).toBeNull();
      },
    );
  });

  it('says there is no request when none is open', async () => {
    request({ open: false });
    await renderIn('rtl', as('student', 'active', () => <VerifyIdentity />)());
    expect(await screen.findByText(ar('account.verifyIdentity.none'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar('account.verifyIdentity.submit') })).toBeNull();
  });

  it('says so in place when the document cannot be sent, and keeps it', async () => {
    request(open);
    mockPick.mockResolvedValue(pdf('id.pdf'));
    mockApi.api.account.identityVerification.submit.mutate.mockRejectedValueOnce(
      apiError('INTERNAL'),
    );
    await renderIn('rtl', as('student', 'verification_required', () => <VerifyIdentity />)());
    await fireEvent.press(await screen.findByText(ar('account.verifyIdentity.upload.nationalId')));
    expect(await screen.findByText('id.pdf')).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: ar('account.verifyIdentity.submit') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(screen.getByText('id.pdf')).toBeTruthy();
  });

  it('offers a retry when the request cannot be read', async () => {
    mockApi.api.account.identityVerification.get.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', as('student', 'verification_required', () => <VerifyIdentity />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
  });

  it('goes back, or home when it was opened with nothing behind it', async () => {
    request(open);
    await renderIn('rtl', as('student', 'verification_required', () => <VerifyIdentity />)());
    await fireEvent.press(await screen.findByRole('button', { name: ar('common.a11y.back') }));
    expect(mockNavigate).toHaveBeenLastCalledWith('back');
    mockCanGoBack = false;
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockNavigate).toHaveBeenLastCalledWith('/');
  });
});

describe('IdentityRequestCard (FR-137)', () => {
  it('shows on a home while the account is under a request, and opens the request', async () => {
    await inBothDirections(
      as('student', 'verification_required', () => <IdentityRequestCard />),
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'account.verifyIdentity.card.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'account.verifyIdentity.card.text'))).toBeTruthy();
      },
    );
    await renderIn('rtl', as('teacher', 'verification_required', () => <IdentityRequestCard />)());
    await fireEvent.press(screen.getByText(ar('account.verifyIdentity.card.title')));
    expect(mockNavigate).toHaveBeenCalledWith('/verify-identity');
  });

  it('draws nothing for an account under no request', async () => {
    await renderIn('rtl', as('student', 'active', () => <IdentityRequestCard />)());
    expect(screen.queryByText(ar('account.verifyIdentity.card.title'))).toBeNull();
  });
});
