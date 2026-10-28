// T034: the root layout: the providers and the session guard, over a mock route tree whose screens
// stand for the ones later batches add (the application in B11, restricted in B13). It lives outside
// `app/`, where every file is a route. T052 (B10b): a restored session lands where `account.me`
// says, and the device's zone is reported when it is one a person lives by. T098: with the tabs
// closed, the deletion of the person's own role stays open through the role group's layout.
// T103: signing out or deleting the account lands on Welcome with nothing behind it. The route map
// holds the `(auth)` routes that sort before `welcome` (expo-router 58 reseeds a group at its first
// route by name length when the guard's Redirect unmounts the navigator), and the back, the
// system's and the arrow's, raises no `GO_BACK` and never returns to a screen open before.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { renderRouter, type RenderRouterResult } from 'expo-router/testing-library';
import { BackHandler, Text, View } from 'react-native';

import { fakeProcedures } from '../features/shared/__tests__/api-double';
import { BackBar } from '../features/shared/screen';
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
jest.mock('../lib/client', () => ({
  ...jest.requireActual<typeof import('../lib/client')>('../lib/client'),
  createApiClient: () => ({ api: mockApi, publicConfig: jest.fn() }),
}));

let mockDeviceZone: string | null = 'Africa/Cairo';
jest.mock('../lib/time-zone', () => ({ deviceTimeZone: () => mockDeviceZone }));

// The account tabs lead to the deletion, whose proof loads the providers' native modules (T084).
jest.mock('../features/shared/auth/providers', () => ({ nativeIdentity: jest.fn() }));

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
  // Unless a case says otherwise, `account.me` is still on its way.
  mockApi.account.me.query.mockReturnValue(new Promise(() => undefined));
  mockDeviceZone = 'Africa/Cairo';
  process.env['EXPO_PUBLIC_API_URL'] = 'https://api.test';
  setLocale('ar');
});
afterEach(() => {
  delete process.env['EXPO_PUBLIC_API_URL'];
});

describe('the root layout', () => {
  it('waits, drawing the loading state, while the session is not known', async () => {
    setSession({ kind: 'restoring' });
    await renderRouter(routes, { initialUrl: '/(auth)/welcome' });
    expect(screen.queryByText('welcome')).toBeNull();
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
