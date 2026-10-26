// T078 (FR-190 to FR-194): the payout screens against their boards, in both languages. The state
// `teacher.payout.get` answers picks the screen: not configured, `PayoutStart`, whose button sends
// the provisional details on a development build and is not drawn on a release build; pending,
// `PayoutSetup`; verified, `PayoutVerified`; rejected, `PayoutRejected` with the gateway's reason as
// plain text (a generic line when none came) and the support line from the public configuration.
import { payoutDetails } from '@ijazah/contracts';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { formatDate, formatWeekdayDate } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { Payout, PayoutChange } from './index';
import { PROVISIONAL_PAYOUT_DETAILS } from './provisional';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
let mockCanGoBack = false;
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    navigate: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
    canGoBack: () => mockCanGoBack,
  },
}));

const mockOpenUrl = jest.fn(async (_url: string) => true);
jest.mock('expo-linking', () => ({ openURL: (url: string) => mockOpenUrl(url) }));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `payout-key-${++mockKey}` }));

let mockDevBuild = true;
jest.mock('./provisional', () => ({
  ...jest.requireActual<typeof import('./provisional')>('./provisional'),
  devRegistrationEnabled: () => mockDevBuild,
}));

jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => 'Africa/Cairo' }));

const CONFIGURED = '2026-11-03T09:00:00.000Z';
const VERIFIED = '2026-11-05T12:30:00.000Z';
const REASON = 'Account holder name does not match the registered name';

const me = {
  userId: '0193a6f0-0000-7000-8000-000000000002',
  role: 'teacher' as const,
  displayName: 'أحمد سالم',
  email: 'ahmed@example.com',
  gender: 'male' as const,
  dateOfBirth: '1980-01-01',
  preferredLanguage: 'ar' as const,
  timezone: 'Africa/Cairo',
  signInMethod: 'google' as const,
  memberSince: '2026-01-10T09:00:00Z',
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

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);

function payout(answer: Record<string, unknown>) {
  mockApi.api.teacher.payout.get.query.mockResolvedValue(answer);
}

beforeEach(() => {
  mockApi = fakeApi();
  mockApi.api.account.me.query.mockResolvedValue(me);
  mockNavigate.mockReset();
  mockOpenUrl.mockClear();
  mockCanGoBack = false;
  mockDevBuild = true;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

describe('PayoutStart', () => {
  it('sends provisional details the contract accepts (OPEN-11)', () => {
    expect(payoutDetails.safeParse(PROVISIONAL_PAYOUT_DETAILS).success).toBe(true);
  });

  it('asks where the payments go, with the button on a development build', async () => {
    payout({ state: 'not_configured' });
    await inBothDirections(
      withQueries(() => <Payout />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.payout.start.heading')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.start.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.start.lede'))).toBeTruthy();
        expect(
          screen.getByRole('button', {
            name: said(direction, 'teacher.payout.start.continueToGateway'),
          }),
        ).toBeTruthy();
      },
    );
  });

  it('draws no button on a release build: the hosted onboarding is Phase 2’s', async () => {
    mockDevBuild = false;
    payout({ state: 'not_configured' });
    await renderIn('rtl', withQueries(() => <Payout />)());
    expect(await screen.findByText(ar('teacher.payout.start.heading'))).toBeTruthy();
    expect(screen.queryByText(ar('teacher.payout.start.continueToGateway'))).toBeNull();
  });

  it('registers the provisional details, keyed, then reads the payout and the account again', async () => {
    payout({ state: 'not_configured' });
    await renderIn('rtl', withQueries(() => <Payout />)());
    payout({ state: 'pending_verification', configuredAt: CONFIGURED });
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.payout.start.continueToGateway') }),
    );
    await waitFor(() =>
      expect(mockApi.api.teacher.payout.register.mutate).toHaveBeenCalledWith({
        details: PROVISIONAL_PAYOUT_DETAILS,
        idempotencyKey: expect.stringMatching(/^payout-key-/),
      }),
    );
    expect(await screen.findByText(ar('teacher.payout.setup.verifyingTitle'))).toBeTruthy();
    expect(queries.getQueryState(ME_QUERY_KEY)?.isInvalidated).toBe(true);
  });

  it('says so when the registration fails, and retries with the same key', async () => {
    payout({ state: 'not_configured' });
    mockApi.api.teacher.payout.register.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <Payout />)());
    const button = () =>
      screen.getByRole('button', { name: ar('teacher.payout.start.continueToGateway') });
    await screen.findByText(ar('teacher.payout.start.heading'));
    await fireEvent.press(button());
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    await fireEvent.press(button());
    await waitFor(() =>
      expect(mockApi.api.teacher.payout.register.mutate).toHaveBeenCalledTimes(2),
    );
    const [first, second] = mockApi.api.teacher.payout.register.mutate.mock.calls;
    expect((second?.[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      (first?.[0] as { idempotencyKey: string }).idempotencyKey,
    );
  });

  it('as a replacement, returns to the payout state once registered', async () => {
    await renderIn('rtl', withQueries(() => <PayoutChange />)());
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.payout.start.continueToGateway') }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/payout'));

    mockNavigate.mockReset();
    mockCanGoBack = true;
    await renderIn('rtl', withQueries(() => <PayoutChange />)());
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.payout.start.continueToGateway') }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('back'));
  });

  it('goes back to the account tab when it has no screen to go back to', async () => {
    payout({ state: 'not_configured' });
    await renderIn('rtl', withQueries(() => <Payout />)());
    await screen.findByText(ar('teacher.payout.start.heading'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)/account');
  });
});

describe('PayoutSetup', () => {
  it('says the account is being verified, since when, and that the teacher is hidden meanwhile', async () => {
    payout({ state: 'pending_verification', configuredAt: CONFIGURED });
    await inBothDirections(
      withQueries(() => <Payout />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.payout.setup.verifyingTitle')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.setup.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'status.payout.verifying'))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.payout.honest.setupVerifying')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.payout.setup.newBankAccount')),
        ).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'teacher.payout.setup.addedOn', {
              date: formatWeekdayDate(
                CONFIGURED,
                'Africa/Cairo',
                direction === 'rtl' ? 'ar' : 'en',
              ),
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.honest.setupNote'))).toBeTruthy();
        // FR-193: the teacher is told they stay hidden until the gateway verifies (B15 review, 1).
        expect(said(direction, 'teacher.payout.honest.setupNote')).toMatch(
          direction === 'rtl' ? /لن تظهر للطلاب/ : /not be visible to students/,
        );
      },
    );
    await renderIn('rtl', withQueries(() => <Payout />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.payout.setup.change') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/payout/start');
  });
});

describe('PayoutVerified', () => {
  it('says the account is verified, when, and leads to today; the Phase 2 rows wait', async () => {
    payout({ state: 'verified', configuredAt: CONFIGURED, verifiedAt: VERIFIED });
    await inBothDirections(
      withQueries(() => <Payout />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.payout.verified.title')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.payout.honest.verifiedLede')),
        ).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.payout.verified.payoutAccount')),
        ).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'teacher.payout.verified.verifiedOn', {
              date: formatDate(VERIFIED, 'Africa/Cairo', direction === 'rtl' ? 'ar' : 'en'),
            }),
          ),
        ).toBeTruthy();
        expect(screen.queryByText(said(direction, 'teacher.payout.verified.packages'))).toBeNull();
        expect(
          screen.queryByText(said(direction, 'teacher.payout.verified.weeklySlots')),
        ).toBeNull();
        expect(
          screen.queryByText(said(direction, 'teacher.payout.verified.reviewPackages')),
        ).toBeNull();
      },
    );
    await renderIn('rtl', withQueries(() => <Payout />)());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('teacher.payout.verified.toToday') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/(tabs)');
    await fireEvent.press(screen.getByText(ar('teacher.payout.verified.payoutAccount')));
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/payout/start');
  });
});

describe('PayoutRejected', () => {
  it('shows the gateway’s reason as it came, the tips and the support line', async () => {
    payout({ state: 'rejected', configuredAt: CONFIGURED, rejectedReason: REASON });
    await inBothDirections(
      withQueries(() => <Payout />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.payout.rejected.heading')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.rejected.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.rejected.lede'))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'teacher.payout.rejected.reasonLabel')),
        ).toBeTruthy();
        expect(screen.getByText(REASON)).toBeTruthy();
        expect(
          screen.queryByText(said(direction, 'teacher.payout.rejected.reasonNone')),
        ).toBeNull();
        expect(screen.getByText(said(direction, 'teacher.payout.rejected.tipName'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'teacher.payout.rejected.tipNumber'))).toBeTruthy();
        expect(
          await screen.findByText(
            said(direction, 'teacher.payout.rejected.supportNote', {
              email: 'support@ijazah.test',
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('says the gateway gave no reason when none came', async () => {
    payout({ state: 'rejected', configuredAt: CONFIGURED });
    await inBothDirections(
      withQueries(() => <Payout />),
      async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'teacher.payout.rejected.reasonNone')),
        ).toBeTruthy();
      },
    );
  });

  it('writes to support and tries again', async () => {
    payout({ state: 'rejected', rejectedReason: REASON });
    await renderIn('rtl', withQueries(() => <Payout />)());
    await fireEvent.press(
      await screen.findByText(
        ar('teacher.payout.rejected.supportNote', { email: 'support@ijazah.test' }),
      ),
    );
    await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith('mailto:support@ijazah.test'));
    await fireEvent.press(
      screen.getByRole('button', { name: ar('teacher.payout.rejected.tryAgain') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(teacher)/payout/start');
  });

  it('draws no support line while the address is unknown', async () => {
    mockApi.value.client.publicConfig.mockRejectedValue(apiError('INTERNAL'));
    payout({ state: 'rejected', rejectedReason: REASON });
    await renderIn('rtl', withQueries(() => <Payout />)());
    expect(await screen.findByText(REASON)).toBeTruthy();
    await waitFor(() => expect(mockApi.value.client.publicConfig).toHaveBeenCalled());
    expect(screen.queryByText(/support@/)).toBeNull();
  });
});

describe('Payout', () => {
  it('says so and offers a retry when the state cannot be read', async () => {
    mockApi.api.teacher.payout.get.query.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', withQueries(() => <Payout />)());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.getByText(ar('teacher.payout.start.title'))).toBeTruthy();
  });
});
