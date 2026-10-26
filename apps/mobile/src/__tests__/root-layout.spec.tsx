// T034: the root layout: the providers and the session guard, over a mock route tree whose screens
// stand for the ones later batches add (the application in B11, restricted in B13). It lives outside
// `app/`, where every file is a route. T052 (B10b): a restored session lands where `account.me`
// says, and the device's zone is reported when it is one a person lives by.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { fakeProcedures } from '../features/shared/__tests__/api-double';
import { setLocale } from '../i18n';
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

const routes = {
  _layout: RootLayout,
  '(auth)/_layout': require('../app/(auth)/_layout').default,
  '(auth)/welcome': stand('welcome'),
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
    setSession({ kind: 'signed-in', landing: 'restricted' });
    await renderRouter(routes, { initialUrl: '/(student)/(tabs)' });
    expect(await screen.findByText('restricted')).toBeTruthy();
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
    setSession({ kind: 'signed-in', landing: 'restricted' });
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
