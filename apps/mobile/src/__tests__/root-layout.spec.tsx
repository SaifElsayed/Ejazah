// T034: the root layout: the providers and the session guard, over a mock route tree whose screens
// stand for the ones later batches add (the application in B11, restricted in B13). It lives outside
// `app/`, where every file is a route. T052 (B10b): a restored session lands where `account.me`
// says, and the device's zone is reported when it is one a person lives by. T098: with the tabs
// closed, the deletion of the person's own role stays open through the role group's layout.
// T103: signing out or deleting the account lands on Welcome with nothing behind it. The route map
// holds the `(auth)` routes that sort before `welcome` (expo-router 58 reseeds a group at its first
// route by name length when the guard's Redirect unmounts the navigator), and the back, the
// system's and the arrow's, raises no `GO_BACK` and never returns to a screen open before.
// T136: signing out or deleting the account leaves no draft behind on the phone: the teacher's
// application (its `reapply` mode with it), the onboarding's, and the pending address and password.
// T138: a launch with no connection says it cannot load instead of waiting on a blank screen.
// T078: every navigator draws its screens' cards and its container in the scheme's background.
// 003:T109 (SRS DEC-87; Q-B3 (a)): «نسخة تجريبية» over every screen while the server's payment mode
// is `test`, none in `live`. 003:T115: the strip reads the mode again when the app comes back to
// the foreground and on reconnect, so a server moved to `live` takes it away from a running app.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import { DefaultTheme, router } from 'expo-router';
import { renderRouter, type RenderRouterResult } from 'expo-router/testing-library';
import { AppState, type AppStateStatus, BackHandler, StyleSheet, Text, View } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { Button } from '../design/primitives';
import { tokens } from '../design/tokens';
import {
  apiError,
  CHECKOUT_POLLING,
  fakeProcedures,
} from '../features/shared/__tests__/api-double';
import {
  clearPendingEmail,
  getPendingEmail,
  setPendingEmail,
} from '../features/shared/auth/pending';
import { useAccountDeletion } from '../features/shared/deletion';
import { clearDraft, getDraft, startOnboarding } from '../features/shared/onboarding/draft';
import { BackBar } from '../features/shared/screen';
import {
  clearApplication,
  getApplication,
  startApplication,
  updateApplication,
} from '../features/teacher/application/draft';
import { type MessageKey, setLocale, translate } from '../i18n';
import { setSession } from '../lib/session';
import RootLayout from '../app/_layout';

// The native layout direction is the device's; a test renders Arabic on a left-to-right runtime and
// must not reload it (the sync itself is lib/direction.spec.ts's).
jest.mock('../lib/direction', () => ({
  ...jest.requireActual<typeof import('../lib/direction')>('../lib/direction'),
  syncNativeDirection: () => false,
}));

let mockApi = fakeProcedures();
// 003:T109: the public configuration the strip reads; `live` unless a case says otherwise.
const publicConfigIn = (paymentMode: 'test' | 'live') => ({
  supportEmail: 'support@ijazah.test',
  termsVersion: '2026-10',
  checkout: CHECKOUT_POLLING,
  teacherSharePercent: 70,
  paymentMode,
  // B-P4 round 2 (Q-B1 (a); rule d): the programme's switch, off as seeded.
  programmeEnabled: false,
});
let mockPublicConfig = jest.fn(async () => publicConfigIn('live'));
// 003:T115: `publicConfig()` keeps its first answer for the launch, as lib/client.ts does (a
// failure is not kept), while `platform.publicConfig` asks the server each time; both answer
// with `mockPublicConfig`.
// 002:T148 (B50): the options the root's client was built with, so a refused refresh can be played.
let mockClientOptions: { readonly onSignedOut?: () => void } = {};
jest.mock('../lib/client', () => ({
  ...jest.requireActual<typeof import('../lib/client')>('../lib/client'),
  createApiClient: (options: { readonly onSignedOut?: () => void }) => {
    mockClientOptions = options;
    let kept: ReturnType<typeof mockPublicConfig> | null = null;
    return {
      api: { ...mockApi, platform: { publicConfig: { query: () => mockPublicConfig() } } },
      publicConfig: () =>
        (kept ??= mockPublicConfig().catch((error: unknown) => {
          kept = null;
          throw error;
        })),
    };
  },
}));

let mockDeviceZone: string | null = 'Africa/Cairo';
jest.mock('../lib/time-zone', () => ({ deviceTimeZone: () => mockDeviceZone }));

// The account tabs lead to the deletion, whose proof loads the providers' native modules (T084).
jest.mock('../features/shared/auth/providers', () => ({
  nativeIdentity: jest.fn(),
  signOutProviders: jest.fn(async () => undefined),
}));

// The system's scheme, as React Native's hook reads it from the Appearance module (T078).
const mockSystemScheme = jest.fn<() => 'light' | 'dark' | null>(() => 'light');
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockSystemScheme(),
}));

const account = (landing: string, extra: Record<string, unknown> = {}) => ({
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل',
  email: null,
  gender: 'female',
  dateOfBirth: '2004-03-12',
  preferredLanguage: 'ar',
  timezone: 'Africa/Cairo',
  signInMethod: 'google',
  memberSince: '2026-02-02T09:00:00Z',
  accountStatus: 'active',
  landing,
  ...extra,
});

const stand = (name: string) => () => <Text>{name}</Text>;

const ar = (key: MessageKey) => translate('ar', key);

/** A stand-in with the arrow of the real screen (`EmailSignIn`, `Otp`), which goes back. */
const withArrow = (name: string) => () => (
  <View>
    <BackBar onPress={() => router.back()} />
    <Text>{name}</Text>
  </View>
);

const routes = {
  _layout: RootLayout,
  // The module, not its default: the layout's `unstable_settings` are part of the route (T103).
  '(auth)/_layout': require('../app/(auth)/_layout'),
  '(auth)/welcome': stand('welcome'),
  // Each sorts before `welcome` by name length (T103).
  '(auth)/otp': withArrow('otp'),
  '(auth)/role': stand('role'),
  '(auth)/banned': stand('banned'),
  '(auth)/profile': stand('profile'),
  '(auth)/email-sign-in': withArrow('email sign-in'),
  '(student)/_layout': require('../app/(student)/_layout').default,
  '(student)/(tabs)/_layout': require('../app/(student)/(tabs)/_layout').default,
  '(student)/(tabs)/index': require('../app/(student)/(tabs)/index').default,
  '(student)/(tabs)/discovery': require('../app/(student)/(tabs)/discovery').default,
  '(student)/(tabs)/enrollments': require('../app/(student)/(tabs)/enrollments').default,
  '(student)/(tabs)/credentials': require('../app/(student)/(tabs)/credentials').default,
  '(student)/(tabs)/account': require('../app/(student)/(tabs)/account').default,
  '(teacher)/_layout': require('../app/(teacher)/_layout').default,
  '(teacher)/(tabs)/_layout': require('../app/(teacher)/(tabs)/_layout').default,
  '(teacher)/(tabs)/index': require('../app/(teacher)/(tabs)/index').default,
  '(teacher)/(tabs)/students': require('../app/(teacher)/(tabs)/students').default,
  '(teacher)/(tabs)/availability': require('../app/(teacher)/(tabs)/availability').default,
  '(teacher)/(tabs)/packages': require('../app/(teacher)/(tabs)/packages').default,
  '(teacher)/(tabs)/account': require('../app/(teacher)/(tabs)/account').default,
  '(teacher)/application/status': stand('application status'),
  '(teacher)/application/subjects': stand('application subjects'),
  '(student)/account/delete': stand('student deletion'),
  '(teacher)/account/delete': stand('teacher deletion'),
  restricted: stand('restricted'),
};

beforeEach(() => {
  mockApi = fakeProcedures();
  mockPublicConfig = jest.fn(async () => publicConfigIn('live'));
  // Unless a case says otherwise, `account.me` is still on its way.
  mockApi.account.me.query.mockReturnValue(new Promise(() => undefined));
  // The homes and tabs read their lists (T050, T051); empty, they draw their empty states.
  mockApi.enrollments.list.query.mockResolvedValue({ items: [] });
  mockApi.teacher.students.list.query.mockResolvedValue({ items: [] });
  mockApi.teacher.today.query.mockResolvedValue({
    localDate: '2026-11-04',
    timezone: 'Africa/Cairo',
    sessions: [],
  });
  mockDeviceZone = 'Africa/Cairo';
  process.env['EXPO_PUBLIC_API_URL'] = 'https://api.test';
  setLocale('ar');
});
afterEach(() => {
  delete process.env['EXPO_PUBLIC_API_URL'];
  onlineManager.setOnline(true);
  mockSystemScheme.mockReset();
  mockSystemScheme.mockReturnValue('light');
});

describe('the test-mode strip (003:T109; SRS DEC-87, Q-B3 (a))', () => {
  it("shows «نسخة تجريبية» over the screen while the server's payment mode is test", async () => {
    mockPublicConfig = jest.fn(async () => publicConfigIn('test'));
    setSession({ kind: 'signed-out' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('welcome')).toBeTruthy();
    expect(await screen.findByText(ar('money.testMode.label'))).toBeTruthy();
  });

  it('shows it while the launch is still waiting for the session', async () => {
    mockPublicConfig = jest.fn(async () => publicConfigIn('test'));
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText(ar('money.testMode.label'))).toBeTruthy();
  });

  it('draws no strip in live mode', async () => {
    setSession({ kind: 'signed-out' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('welcome')).toBeTruthy();
    await waitFor(() => expect(mockPublicConfig).toHaveBeenCalled());
    // The answer has rendered before the strip is looked for.
    await act(async () => {
      await mockPublicConfig.mock.results[0]?.value;
    });
    expect(screen.queryByText(ar('money.testMode.label'))).toBeNull();
  });
});

describe('the test-mode strip reads the mode again (003:T115; PR #144 r1, finding 3 (b))', () => {
  type Listener = (status: AppStateStatus) => void;
  // React Native's Jest mock of AppState is shared by every case; it is swapped for this block's
  // and put back, never reset (a reset one would hand the next case no subscription).
  const addEventListener = AppState.addEventListener;
  let appStateListeners: Listener[];

  beforeEach(() => {
    appStateListeners = [];
    Object.assign(AppState, {
      addEventListener: (_type: string, listener: Listener) => {
        appStateListeners.push(listener);
        return { remove: () => undefined };
      },
    });
  });
  afterEach(() => {
    Object.assign(AppState, { addEventListener });
    // The layout's `followAppState` heard the same changes; the next case starts with no focus set.
    focusManager.setFocused(undefined);
  });

  /** Reports a change of the app's state, as AppState does, to every listener added since. */
  const appStateBecomes = async (status: AppStateStatus) => {
    await act(async () => {
      for (const listener of appStateListeners) listener(status);
    });
  };

  /** Renders Welcome signed out and waits until the strip's first answer has rendered. */
  const launch = async () => {
    setSession({ kind: 'signed-out' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('welcome')).toBeTruthy();
    await waitFor(() => expect(mockPublicConfig).toHaveBeenCalled());
    await act(async () => {
      await mockPublicConfig.mock.results[0]?.value;
    });
  };

  it('takes the strip away once the server says live and the app comes back to the foreground', async () => {
    mockPublicConfig.mockResolvedValue(publicConfigIn('test'));
    await launch();
    expect(screen.getByText(ar('money.testMode.label'))).toBeTruthy();
    mockPublicConfig.mockResolvedValue(publicConfigIn('live'));
    await appStateBecomes('background');
    await appStateBecomes('active');
    await waitFor(() => expect(screen.queryByText(ar('money.testMode.label'))).toBeNull());
  });

  it('draws the strip once the server says test and the app comes back to the foreground', async () => {
    await launch();
    expect(screen.queryByText(ar('money.testMode.label'))).toBeNull();
    mockPublicConfig.mockResolvedValue(publicConfigIn('test'));
    await appStateBecomes('active');
    expect(await screen.findByText(ar('money.testMode.label'))).toBeTruthy();
  });

  it('asks nothing while the app goes to the background or the switcher', async () => {
    mockPublicConfig.mockResolvedValue(publicConfigIn('test'));
    await launch();
    const asked = mockPublicConfig.mock.calls.length;
    await appStateBecomes('inactive');
    await appStateBecomes('background');
    expect(mockPublicConfig.mock.calls.length).toBe(asked);
  });

  it('takes the strip away once the server says live and the connection returns', async () => {
    mockPublicConfig.mockResolvedValue(publicConfigIn('test'));
    await launch();
    expect(screen.getByText(ar('money.testMode.label'))).toBeTruthy();
    mockPublicConfig.mockResolvedValue(publicConfigIn('live'));
    await act(async () => {
      onlineManager.setOnline(false);
    });
    await act(async () => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(screen.queryByText(ar('money.testMode.label'))).toBeNull());
  });

  it('keeps the strip when a read on the way back fails', async () => {
    mockPublicConfig.mockResolvedValue(publicConfigIn('test'));
    await launch();
    const asked = mockPublicConfig.mock.calls.length;
    mockPublicConfig.mockRejectedValue(new Error('no answer'));
    await appStateBecomes('active');
    await waitFor(() => expect(mockPublicConfig.mock.calls.length).toBeGreaterThan(asked));
    await act(async () => {
      await Promise.allSettled([mockPublicConfig.mock.results.at(-1)?.value]);
    });
    expect(screen.getByText(ar('money.testMode.label'))).toBeTruthy();
  });
});

describe('the root layout', () => {
  it('waits, drawing the loading state, while the session is not known', async () => {
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(screen.queryByText('welcome')).toBeNull();
  });

  // T138: with no connection the read of `account.me` waits for one, so the launch says so.
  it('says it cannot load, with a retry, when it launches with no connection', async () => {
    onlineManager.setOnline(false);
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(screen.getByRole('button', { name: ar('common.action.retry') })).toBeTruthy();
    expect(mockApi.account.me.query).not.toHaveBeenCalled();
  });

  it('lands a signed-out person on the welcome screen', async () => {
    setSession({ kind: 'signed-out' });
    await renderRouter(routes, { initialUrl: '/(student)/(tabs)' });
    expect(await screen.findByText('welcome')).toBeTruthy();
  });

  it("lands a student on the student's tabs, with the bar", async () => {
    setSession({ kind: 'signed-in', landing: 'student_home' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('اختر معلمًا وباقة تناسبك')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'الرئيسية' }).props['accessibilityState']).toMatchObject(
      {
        selected: true,
      },
    );
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('lands an applicant on the application by its status', async () => {
    setSession({
      kind: 'signed-in',
      landing: 'teacher_application',
      applicationStatus: 'in_review',
    });
    await renderRouter(routes, { initialUrl: '/(teacher)/(tabs)' });
    expect(await screen.findByText('application status')).toBeTruthy();
  });

  it('lands a restricted account on the restricted screen', async () => {
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'student' });
    await renderRouter(routes, { initialUrl: '/(student)/(tabs)' });
    expect(await screen.findByText('restricted')).toBeTruthy();
  });

  it("lets a restricted account stay on its own role's deletion, and lands it from the other's (T098)", async () => {
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'student' });
    await renderRouter(routes, { initialUrl: '/(student)/account/delete' });
    expect(await screen.findByText('student deletion')).toBeTruthy();
    await act(async () =>
      setSession({ kind: 'signed-in', landing: 'restricted', role: 'teacher' }),
    );
    expect(await screen.findByText('restricted')).toBeTruthy();
  });

  it("lets a restricted teacher and an applicant stay on the teacher's deletion (T098)", async () => {
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'teacher' });
    await renderRouter(routes, { initialUrl: '/(teacher)/account/delete' });
    expect(await screen.findByText('teacher deletion')).toBeTruthy();
    await act(async () =>
      setSession({
        kind: 'signed-in',
        landing: 'teacher_application',
        applicationStatus: 'rejected',
      }),
    );
    expect(screen.getByText('teacher deletion')).toBeTruthy();
  });

  it('lands the welcome screen once the deletion signs the person out (T098)', async () => {
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'student' });
    await renderRouter(routes, { initialUrl: '/(student)/account/delete' });
    expect(await screen.findByText('student deletion')).toBeTruthy();
    await act(async () => setSession({ kind: 'signed-out' }));
    expect(await screen.findByText('welcome')).toBeTruthy();
  });

  it('signs the phone out of Google too when a refused refresh ends the session (002:T148, B50)', async () => {
    const { signOutProviders } = jest.requireMock<{ signOutProviders: jest.Mock }>(
      '../features/shared/auth/providers',
    );
    signOutProviders.mockClear();
    setSession({ kind: 'signed-in', landing: 'teacher_home' });
    await renderRouter(routes, { initialUrl: '/(teacher)/(tabs)' });
    expect(await screen.findByText('لا جلسات في هذا اليوم')).toBeTruthy();
    await act(async () => mockClientOptions.onSignedOut?.());
    expect(await screen.findByText('welcome')).toBeTruthy();
    await waitFor(() => expect(signOutProviders).toHaveBeenCalledTimes(1));
  });

  it('moves the person when the session changes', async () => {
    setSession({ kind: 'signed-in', landing: 'teacher_home' });
    await renderRouter(routes, { initialUrl: '/(teacher)/(tabs)' });
    expect(await screen.findByText('لا جلسات في هذا اليوم')).toBeTruthy();
    await act(async () => setSession({ kind: 'signed-out' }));
    expect(await screen.findByText('welcome')).toBeTruthy();
  });

  it('clears what the queries hold when the person signs out (review of B6, 4)', async () => {
    const Remember = () => {
      useQueryClient().setQueryData(['account'], 'the previous account');
      return <Text>remembered</Text>;
    };
    const Recall = () => {
      const held = useQueryClient().getQueryData<string>(['account']);
      return <Text>{held ?? 'nothing held'}</Text>;
    };
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'student' });
    await renderRouter(
      { ...routes, restricted: Remember, '(auth)/welcome': Recall },
      { initialUrl: '/restricted' },
    );
    expect(await screen.findByText('remembered')).toBeTruthy();
    await act(async () => setSession({ kind: 'signed-out' }));
    expect(await screen.findByText('nothing held')).toBeTruthy();
  });

  it('lands a restored session where account.me says, an applicant by its status (T052)', async () => {
    mockApi.account.me.query.mockResolvedValue(
      account('teacher_application', {
        role: 'teacher',
        teacher: {
          applicationStatus: 'in_review',
          verificationStatus: 'pending',
          payout: { configured: false, verified: false },
        },
      }),
    );
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('application status')).toBeTruthy();
  });

  it('says a launch whose account cannot be read, and retries it', async () => {
    mockApi.account.me.query.mockRejectedValue(new Error('offline'));
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(
      await screen.findByText('تعذّر تحميل البيانات. حاول مرة أخرى.', {}, { timeout: 10000 }),
    ).toBeTruthy();
    mockApi.account.me.query.mockResolvedValue(account('restricted'));
    await fireEvent.press(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByText('restricted')).toBeTruthy();
  }, 20000);

  // T065 (research R-325, item 3): the query cache retries no API refusal, so a refused read
  // counts once against a limit; a failure with no answer is still retried, as the case above.
  it('says at once a launch whose account read was refused, asking account.me once (T065)', async () => {
    mockApi.account.me.query.mockRejectedValue(apiError('INTERNAL'));
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    expect(mockApi.account.me.query).toHaveBeenCalledTimes(1);
  });

  // T065 (the owner's decision of 2026-11-06, the RATE_LIMITED message): the launch's own read,
  // refused by a limit, says when to try again, as every generic-error path does.
  it('says when to try again when the launch read is refused RATE_LIMITED (T065)', async () => {
    mockApi.account.me.query.mockRejectedValue(
      apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(
      await screen.findByText(translate('ar', 'common.state.rateLimitedIn', { count: 2 })),
    ).toBeTruthy();
    expect(screen.queryByText(ar('common.state.loadError'))).toBeNull();
  });

  it('says to wait a little when the launch read is refused RATE_LIMITED with no time (T065)', async () => {
    mockApi.account.me.query.mockRejectedValue(apiError('RATE_LIMITED'));
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText(ar('common.state.rateLimited'))).toBeTruthy();
  });

  // T065 (research R-324, item 3): one live channel at the root while the person is signed in.
  it('opens the live channel once signed in, and closes it on signing out (T065)', async () => {
    // React Native's Jest mock of AppState holds no state; the app is in the foreground here.
    const foreground = AppState.currentState;
    Object.assign(AppState, { currentState: 'active' });
    try {
      await liveChannelOpensAndCloses();
    } finally {
      Object.assign(AppState, { currentState: foreground });
    }
  });

  // T065, beyond its text (the owner's decision of 2026-11-11 on lane A2's Q3, (b)): the server
  // refuses the channel to a restricted standing, so a restricted account opens none, and one opens
  // once the account leaves the restricted screen.
  it('opens no live channel while the account is restricted, and one once it is not (T065)', async () => {
    const foreground = AppState.currentState;
    Object.assign(AppState, { currentState: 'active' });
    try {
      setSession({ kind: 'signed-in', landing: 'restricted', role: 'student' });
      await renderRouter(routes, { initialUrl: '/(student)/(tabs)' });
      expect(await screen.findByText('restricted')).toBeTruthy();
      expect(mockApi.live.events.subscribe).not.toHaveBeenCalled();
      await act(async () => setSession({ kind: 'signed-in', landing: 'student_home' }));
      expect(await screen.findByText('اختر معلمًا وباقة تناسبك')).toBeTruthy();
      // As in the case above, a layout mounted again closes its stream first: one is open.
      expect(mockApi.live.events.subscribe).toHaveBeenCalled();
      expect(openStreams()).toBe(1);
    } finally {
      Object.assign(AppState, { currentState: foreground });
    }
  });

  async function liveChannelOpensAndCloses() {
    setSession({ kind: 'signed-in', landing: 'student_home' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('اختر معلمًا وباقة تناسبك')).toBeTruthy();
    // A layout mounted again closes its stream first: one stream is open at a time.
    expect(openStreams()).toBe(1);
    const opens = mockApi.live.events.subscribe.mock.calls.length;
    await act(async () => setSession({ kind: 'signed-out' }));
    expect(await screen.findByText('welcome')).toBeTruthy();
    expect(openStreams()).toBe(0);
    expect(mockApi.live.events.subscribe).toHaveBeenCalledTimes(opens);
  }

  /** The streams opened and not yet closed. */
  function openStreams(): number {
    return mockApi.live.events.subscribe.mock.results.filter(
      (result) => (result.value as { unsubscribe: jest.Mock }).unsubscribe.mock.calls.length === 0,
    ).length;
  }

  it("reports the device's zone once when it differs from the account's (FR-131)", async () => {
    mockApi.account.me.query.mockResolvedValue(
      account('student_home', { timezone: 'Asia/Riyadh' }),
    );
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    await waitFor(() =>
      expect(mockApi.account.reportDeviceTimezone.mutate).toHaveBeenCalledWith({
        timezone: 'Africa/Cairo',
      }),
    );
    expect(mockApi.account.reportDeviceTimezone.mutate).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for a device on UTC, nor for the zone the account already has', async () => {
    mockDeviceZone = null;
    mockApi.account.me.query.mockResolvedValue(
      account('student_home', { timezone: 'Asia/Riyadh' }),
    );
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(await screen.findByText('اختر معلمًا وباقة تناسبك')).toBeTruthy();
    expect(mockApi.account.reportDeviceTimezone.mutate).not.toHaveBeenCalled();
  });

  it('lets a signed-out person open the time-zone picker during the onboarding (T051)', async () => {
    setSession({ kind: 'signed-out' });
    await renderRouter({ ...routes, 'time-zone': stand('picker') }, { initialUrl: '/time-zone' });
    expect(await screen.findByText('picker')).toBeTruthy();
  });

  it('switches tabs through the bar', async () => {
    setSession({ kind: 'signed-in', landing: 'teacher_home' });
    await renderRouter(routes, { initialUrl: '/(teacher)/(tabs)' });
    await fireEvent.press(screen.getByRole('tab', { name: 'طلابي' }));
    expect(await screen.findByText('لا طلاب بعد')).toBeTruthy();
  });
});

/**
 * The colours the navigators draw around a screen, from its text outwards: each stack's card (the
 * view whose padding holds the system bars' insets) and each stack's own container.
 */
function backgroundsAround(node: TestInstance): unknown[] {
  const drawn: unknown[] = [];
  for (let at: TestInstance | null = node; at !== null; at = at.parent) {
    if (at.type === 'RNSScreenContentWrapper') {
      drawn.push(StyleSheet.flatten(at.props['style'])?.backgroundColor);
    }
    if (at.type === 'RNSScreenStack') drawn.push(at.props['nativeContainerBackgroundColor']);
  }
  return drawn;
}

// T078 (B28's device run): a screen pushed above the tabs showed react-navigation's default light
// grey behind the status bar and the navigation bar, in the dark scheme; the root and the role
// group's stacks now draw the scheme's background there.
describe('the background behind the system bars (T078)', () => {
  const pushed = [
    {
      role: 'student',
      landing: 'student_home',
      tabs: '/(student)/(tabs)',
      href: '/(student)/account/delete',
      text: 'student deletion',
    },
    {
      role: 'teacher',
      landing: 'teacher_home',
      tabs: '/(teacher)/(tabs)',
      href: '/(teacher)/account/delete',
      text: 'teacher deletion',
    },
  ] as const;

  for (const scheme of ['dark', 'light'] as const) {
    for (const { role, landing, tabs, href, text } of pushed) {
      it(`draws the ${scheme} background around a screen the ${role} pushes above the tabs`, async () => {
        mockSystemScheme.mockReturnValue(scheme);
        setSession({ kind: 'signed-in', landing });
        await renderRouter(routes, { initialUrl: tabs });
        await act(async () => router.push(href as never));
        const drawn = backgroundsAround(await screen.findByText(text));
        // Two stacks, the root's and the role group's, each with its container and the card.
        expect(drawn).toHaveLength(4);
        expect(drawn).not.toContain(DefaultTheme.colors.background);
        expect(new Set(drawn)).toEqual(new Set([tokens.color[scheme].bg]));
      });
    }
  }
});

/** The navigator's tree as `getRouterState()` returns it, by route name. */
interface Tree {
  readonly routes: readonly { readonly name: string; readonly state?: Tree | undefined }[];
}

const treeOf = (rendered: RenderRouterResult) =>
  rendered.getRouterState() as unknown as Tree | undefined;

/** Every route the navigators hold, focused or not; the router's own `__` routes left out. */
function routeNames(tree: Tree | undefined): string[] {
  return (tree?.routes ?? []).flatMap((route) => [
    ...(route.name.startsWith('__') ? [] : [route.name]),
    ...routeNames(route.state),
  ]);
}

/** The routes of the stack the route `name` holds. */
function stackOf(tree: Tree | undefined, name: string): string[] | undefined {
  for (const route of tree?.routes ?? []) {
    if (route.name === name) return route.state?.routes.map((held) => held.name);
    const found = stackOf(route.state, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The routes a signed-out person must never be able to go back to. */
const PROTECTED = ['(student)', '(teacher)', 'restricted'];

describe('signing out or deleting the account (T103)', () => {
  // The system back: expo-router's listener and any a screen adds, newest first as Android calls them.
  const backListeners: Parameters<typeof BackHandler.addEventListener>[1][] = [];
  let errors: jest.SpiedFunction<typeof console.error>;
  let backHandler: jest.SpiedFunction<typeof BackHandler.addEventListener>;

  beforeEach(() => {
    backListeners.length = 0;
    backHandler = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        backListeners.push(handler);
        return {
          remove: () => {
            const at = backListeners.indexOf(handler);
            if (at !== -1) backListeners.splice(at, 1);
          },
        };
      });
    errors = jest.spyOn(console, 'error');
  });
  afterEach(() => {
    backHandler.mockRestore();
    errors.mockRestore();
  });

  /** Presses the system back; true when the app handled it, false when Android would close it. */
  async function pressSystemBack(): Promise<boolean> {
    let handled = false;
    await act(async () => {
      handled = [...backListeners]
        .reverse()
        .some((listener) => listener({ type: 'hardwareBackPress', timeStamp: 0 }) === true);
    });
    return handled;
  }

  const goBackRaised = () =>
    errors.mock.calls.some((call) => String(call[0]).includes("'GO_BACK'"));

  async function signOutThroughTheSheet(label: MessageKey) {
    const [open] = await screen.findAllByRole('button', { name: new RegExp(ar(label)) });
    await fireEvent.press(open!);
    expect(await screen.findByText(ar('account.signOutSheet.title'))).toBeTruthy();
    // The sheet's confirmation, which says the same words as the button that opened it.
    const [confirm] = screen
      .getAllByRole('button', { name: ar('account.signOutSheet.confirm') })
      .filter((button) => button !== open);
    await fireEvent.press(confirm!);
  }

  /** Welcome, the first screen of `(auth)`, with no screen behind it and none from before. */
  async function expectWelcomeWithNothingBehind(rendered: RenderRouterResult, before: string) {
    await waitFor(() => expect(screen.queryByText(before)).toBeNull());
    expect(rendered.getSegments()).toEqual(['(auth)', 'welcome']);
    expect(screen.getByText('welcome')).toBeTruthy();
    expect(routeNames(treeOf(rendered))).toEqual(['(auth)', 'welcome']);
    expect(router.canGoBack()).toBe(false);
    // Nothing to go back to: Android closes the app, as from any first screen.
    expect(await pressSystemBack()).toBe(false);
    expect(rendered.getSegments()).toEqual(['(auth)', 'welcome']);
    expect(screen.queryByText(before)).toBeNull();
    expect(goBackRaised()).toBe(false);
  }

  /** The restricted screen, with none of the role's screens behind it. */
  async function expectRestrictedWithNothingBehind(rendered: RenderRouterResult, title: string) {
    expect(await screen.findByText(title)).toBeTruthy();
    expect(rendered.getSegments()).toEqual(['restricted']);
    expect(routeNames(treeOf(rendered)).filter((name) => PROTECTED.includes(name))).toEqual([
      'restricted',
    ]);
    expect(await pressSystemBack()).toBe(false);
    expect(rendered.getSegments()).toEqual(['restricted']);
    expect(goBackRaised()).toBe(false);
  }

  it('a student signs out from the account tab', async () => {
    mockApi.account.me.query.mockResolvedValue(account('student_home'));
    setSession({ kind: 'signed-in', landing: 'student_home' });
    const rendered = await renderRouter(routes, { initialUrl: '/(student)/(tabs)/account' });
    expect(await screen.findByText('أمل')).toBeTruthy();
    await signOutThroughTheSheet('account.signOut');
    await expectWelcomeWithNothingBehind(rendered, 'أمل');
  });

  it('a teacher signs out from the account tab', async () => {
    mockApi.account.me.query.mockResolvedValue(
      account('teacher_home', {
        role: 'teacher',
        teacher: {
          applicationStatus: 'approved',
          verificationStatus: 'approved',
          payout: { configured: true, verified: true },
        },
      }),
    );
    setSession({ kind: 'signed-in', landing: 'teacher_home' });
    const rendered = await renderRouter(routes, { initialUrl: '/(teacher)/(tabs)/account' });
    expect(await screen.findByText('أمل')).toBeTruthy();
    await signOutThroughTheSheet('common.action.signOut');
    await expectWelcomeWithNothingBehind(rendered, 'أمل');
  });

  it("a teacher signs out while applying, from the application's status", async () => {
    mockApi.account.me.query.mockResolvedValue(
      account('teacher_application', {
        role: 'teacher',
        teacher: {
          applicationStatus: 'in_review',
          verificationStatus: 'pending',
          payout: { configured: false, verified: false },
        },
      }),
    );
    mockApi.teacher.application.get.query.mockResolvedValue({
      status: 'in_review',
      submittedAt: '2026-02-03T09:00:00Z',
      subjectCount: 2,
    });
    setSession({
      kind: 'signed-in',
      landing: 'teacher_application',
      applicationStatus: 'in_review',
    });
    const rendered = await renderRouter(
      {
        ...routes,
        '(teacher)/application/status': require('../app/(teacher)/application/status').default,
      },
      { initialUrl: '/(teacher)/application/status' },
    );
    expect(await screen.findByText(ar('teacher.application.status.title'))).toBeTruthy();
    await signOutThroughTheSheet('common.action.signOut');
    await expectWelcomeWithNothingBehind(rendered, ar('teacher.application.status.title'));
  });

  it('an account is deleted, from the deletion its account tab opened', async () => {
    mockApi.account.me.query.mockResolvedValue(account('student_home'));
    setSession({ kind: 'signed-in', landing: 'student_home' });
    const rendered = await renderRouter(routes, { initialUrl: '/(student)/(tabs)/account' });
    expect(await screen.findByText('أمل')).toBeTruthy();
    await act(async () => router.push('/(student)/account/delete'));
    expect(await screen.findByText('student deletion')).toBeTruthy();
    // What the deletion does once the server deleted the account (features/shared/deletion/api.ts).
    await act(async () => setSession({ kind: 'signed-out' }));
    await expectWelcomeWithNothingBehind(rendered, 'student deletion');
  });

  it('a suspended account lands on the restricted screen, and signs out from it', async () => {
    mockApi.account.me.query.mockResolvedValue(
      account('restricted', { accountStatus: 'suspended' }),
    );
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'student' });
    const rendered = await renderRouter(
      { ...routes, restricted: require('../app/restricted').default },
      { initialUrl: '/(student)/(tabs)' },
    );
    await expectRestrictedWithNothingBehind(rendered, ar('account.restricted.title'));
    await signOutThroughTheSheet('account.restricted.signOut');
    await expectWelcomeWithNothingBehind(rendered, ar('account.restricted.title'));
  });

  it('a banned account lands on the restricted screen, and signs out from it', async () => {
    mockApi.account.me.query.mockResolvedValue(
      account('restricted', { role: 'teacher', accountStatus: 'banned' }),
    );
    setSession({ kind: 'signed-in', landing: 'restricted', role: 'teacher' });
    const rendered = await renderRouter(
      { ...routes, restricted: require('../app/restricted').default },
      { initialUrl: '/(teacher)/(tabs)' },
    );
    await expectRestrictedWithNothingBehind(rendered, ar('teacher.restricted.bannedTitle'));
    await signOutThroughTheSheet('account.restricted.signOut');
    await expectWelcomeWithNothingBehind(rendered, ar('teacher.restricted.bannedTitle'));
  });

  it('a deep link into (auth) opens with Welcome below it', async () => {
    setSession({ kind: 'signed-out' });
    const rendered = await renderRouter(routes, { initialUrl: '/(auth)/email-sign-in' });
    expect(await screen.findByText('email sign-in')).toBeTruthy();
    expect(stackOf(treeOf(rendered), '(auth)')).toEqual(['welcome', 'email-sign-in']);
    // The system back returns to Welcome, and so does the screen's arrow.
    expect(await pressSystemBack()).toBe(true);
    expect(await screen.findByText('welcome')).toBeTruthy();
    expect(rendered.getSegments()).toEqual(['(auth)', 'welcome']);
    await act(async () => router.push('/(auth)/email-sign-in'));
    expect(await screen.findByText('email sign-in')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.a11y.back') }));
    expect(await screen.findByText('welcome')).toBeTruthy();
    expect(rendered.getSegments()).toEqual(['(auth)', 'welcome']);
    expect(await pressSystemBack()).toBe(false);
    expect(goBackRaised()).toBe(false);
  });
});

describe('signing out or deleting the account leaves no draft behind (T136)', () => {
  const applicant = account('teacher_application', {
    role: 'teacher',
    teacher: {
      applicationStatus: 'rejected',
      verificationStatus: 'pending',
      payout: { configured: false, verified: false },
    },
  });

  /** What one person left on the phone: every draft, and the pending address with its password. */
  function leaveDraftsBehind(): void {
    startApplication('reapply');
    updateApplication({ subjectIds: ['subject-1'], qualification: 'إجازة بحفص' });
    startOnboarding({
      onboardingToken: 'onboarding-token',
      identity: 'email',
      emailVerified: true,
      email: 'amal@example.test',
      password: 'the typed password',
      timezone: 'Africa/Cairo',
    });
    setPendingEmail('amal@example.test', 'the typed password');
  }

  function expectNothingLeft(): void {
    expect(getApplication()).toMatchObject({
      mode: 'submit',
      subjectIds: [],
      qualification: '',
      identity: undefined,
      ijazahs: {},
    });
    expect(getDraft()).toBeNull();
    expect(getPendingEmail()).toBeNull();
  }

  afterEach(() => {
    clearApplication();
    clearDraft();
    clearPendingEmail();
  });

  it("an applicant signs out from the application's status", async () => {
    mockApi.account.me.query.mockResolvedValue(applicant);
    mockApi.teacher.application.get.query.mockResolvedValue({
      status: 'rejected',
      submittedAt: '2026-02-03T09:00:00Z',
      subjectCount: 2,
      note: 'الإجازة غير واضحة',
      callRecorded: false,
      decidedAt: '2026-02-05T09:00:00Z',
      approvedShown: false,
    });
    setSession({
      kind: 'signed-in',
      landing: 'teacher_application',
      applicationStatus: 'rejected',
    });
    await renderRouter(
      {
        ...routes,
        '(teacher)/application/status': require('../app/(teacher)/application/status').default,
      },
      { initialUrl: '/(teacher)/application/status' },
    );
    expect(await screen.findByText(ar('teacher.application.rejected.heading'))).toBeTruthy();
    leaveDraftsBehind();
    const [open] = await screen.findAllByRole('button', {
      name: new RegExp(ar('common.action.signOut')),
    });
    await fireEvent.press(open!);
    const [confirm] = screen
      .getAllByRole('button', { name: ar('account.signOutSheet.confirm') })
      .filter((button) => button !== open);
    await fireEvent.press(confirm!);
    expect(await screen.findByText('welcome')).toBeTruthy();
    expectNothingLeft();
  });

  it('an applicant deletes the account', async () => {
    const Deletion = () => {
      const deletion = useAccountDeletion();
      return (
        <Button
          label="delete"
          onPress={() =>
            void deletion.deleteAccount('DELETE', { kind: 'password', password: 'secret' })
          }
        />
      );
    };
    mockApi.account.me.query.mockResolvedValue(applicant);
    setSession({
      kind: 'signed-in',
      landing: 'teacher_application',
      applicationStatus: 'rejected',
    });
    await renderRouter(
      { ...routes, '(teacher)/account/delete': Deletion },
      { initialUrl: '/(teacher)/account/delete' },
    );
    leaveDraftsBehind();
    await fireEvent.press(await screen.findByRole('button', { name: 'delete' }));
    expect(await screen.findByText('welcome')).toBeTruthy();
    expect(mockApi.account.delete.mutate).toHaveBeenCalledTimes(1);
    expectNothingLeft();
  });
});
