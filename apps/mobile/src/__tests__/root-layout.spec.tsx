// T034: the root layout: the providers and the session guard, over a mock route tree whose screens
// stand for the ones later batches add (welcome in B10, the application in B11, restricted in B13).
// It lives outside `app/`, where every file is a route.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { setLocale } from '../i18n';
import { setSession } from '../lib/session';
import RootLayout from '../app/_layout';

// The native layout direction is the device's; a test renders Arabic on a left-to-right runtime and
// must not reload it (the sync itself is lib/direction.spec.ts's).
jest.mock('../lib/direction', () => ({
  ...jest.requireActual<typeof import('../lib/direction')>('../lib/direction'),
  syncNativeDirection: () => false,
}));

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

  it('switches tabs through the bar', async () => {
    setSession({ kind: 'signed-in', landing: 'teacher_home' });
    await renderRouter(routes, { initialUrl: '/(teacher)/(tabs)' });
    await fireEvent.press(screen.getByRole('tab', { name: 'طلابي' }));
    expect(await screen.findByText('لا طلاب بعد')).toBeTruthy();
  });
});
