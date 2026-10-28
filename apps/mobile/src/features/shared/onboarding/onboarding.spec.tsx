// T051 (FR-124 to FR-127): the onboarding against the boards, in both languages. Role, then the
// profile (Terms unchecked and «متابعة» disabled until ticked; the email and code only for a
// provider identity with no verified address), the time-zone picker over the city list, the Terms
// as served content, and the confirmation sheet whose confirm creates the account in one call to
// `onboarding.complete` and lands the person through the guard.
//
// T097 (FR-155): `complete` refused with `ACCOUNT_RESTRICTED` (the identifiers of a banned person's
// deleted account) lands on the signed-out banned state and forgets the draft, storing no session.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { timeZoneCities } from '@ijazah/time/cities';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, setLocale, translate } from '../../../i18n';
import { nameOrder } from '../../../lib/formatters';
import { getSession, setSession } from '../../../lib/session';
import { apiError, fakeApi, tokens } from '../__tests__/api-double';
import { clearDraft, getDraft, startOnboarding, updateDraft } from './draft';
import { OnboardProfile, Role, Terms, TimeZonePicker } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({
  ...jest.requireActual<typeof import('../../../lib/api')>('../../../lib/api'),
  useApi: () => mockApi.value,
}));

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
  Redirect: ({ href }: { href: string }) => {
    mockNavigate(href);
    return null;
  },
}));

// The native provider modules are not part of these screens.
jest.mock('../auth/providers', () => ({ nativeIdentity: jest.fn() }));

let mockDeviceZone: string | null = 'Africa/Cairo';
jest.mock('../../../lib/time-zone', () => ({ deviceTimeZone: () => mockDeviceZone }));

// The real order of names, counted: the picker builds one per language (T104).
const actualFormatters =
  jest.requireActual<typeof import('../../../lib/formatters')>('../../../lib/formatters');
jest.mock('../../../lib/formatters', () => {
  const actual =
    jest.requireActual<typeof import('../../../lib/formatters')>('../../../lib/formatters');
  return { ...actual, nameOrder: jest.fn(actual.nameOrder) };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const { pickerDateOf } =
    jest.requireActual<typeof import('@ijazah/time/calendar')>('@ijazah/time/calendar');
  return {
    __esModule: true,
    default: ({ onChange }: { onChange: (event: { type: string }, date?: Date) => void }) =>
      createElement(Pressable, {
        testID: 'date-picker',
        onPress: () => onChange({ type: 'set' }, pickerDateOf('2004-03-12')),
      }),
  };
});

let mockWebView: { uri: string; onError?: () => void } | null = null;
jest.mock('react-native-webview', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    WebView: (props: { source: { uri: string }; onError?: () => void }) => {
      mockWebView = { uri: props.source.uri, ...(props.onError ? { onError: props.onError } : {}) };
      return createElement(Text, null, 'web view');
    },
  };
});

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: Record<string, string>) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: Record<string, string>) => translate('ar', key, values);

const withQueries = (ui: ReactElement) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

function startAs(identity: 'email' | 'provider', emailVerified = true) {
  startOnboarding({
    onboardingToken: 'onboarding-1',
    identity,
    emailVerified,
    email: emailVerified ? 'amal@example.com' : undefined,
    displayName: 'أمل',
    ...(identity === 'email' ? { password: 'a long secret' } : {}),
    timezone: 'Africa/Cairo',
  });
}

beforeEach(() => {
  mockApi = fakeApi();
  mockNavigate.mockReset();
  mockDeviceZone = 'Africa/Cairo';
  mockWebView = null;
  setSession({ kind: 'signed-out' });
  startAs('provider');
});

describe('Role', () => {
  it('draws the step, the question and the two roles with their hints', async () => {
    await inBothDirections(
      () => <Role />,
      (_rendered, direction) => {
        // The title is the step indicator's first step too.
        expect(screen.getAllByText(said(direction, 'onboarding.role.title'))).toHaveLength(2);
        expect(screen.getByText(said(direction, 'onboarding.role.lede'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'onboarding.role.studentHint'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'onboarding.role.teacherHint'))).toBeTruthy();
      },
    );
  });

  it('chooses nothing for the person: «التالي» waits for a role, then opens the profile', async () => {
    await renderIn('rtl', <Role />);
    const next = screen.getByRole('button', { name: ar('common.action.next') });
    expect(next.props['accessibilityState']).toMatchObject({ disabled: true });
    await fireEvent.press(
      screen.getByRole('radio', { name: new RegExp(`^${ar('onboarding.role.teacher')}`) }),
    );
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.next') }));
    expect(getDraft()?.role).toBe('teacher');
    expect(mockNavigate).toHaveBeenCalledWith('/(auth)/profile');
  });

  it('sends a person with no onboarding under way back to the welcome screen', async () => {
    clearDraft();
    await renderIn('rtl', <Role />);
    expect(mockNavigate).toHaveBeenCalledWith('/(auth)/welcome');
  });
});

describe('OnboardProfile', () => {
  const fillProfile = async () => {
    await fireEvent.press(screen.getByRole('radio', { name: ar('common.gender.female') }));
    await fireEvent.press(
      screen.getByRole('button', { name: ar('onboarding.profile.dateOfBirth') }),
    );
    await fireEvent.press(screen.getByTestId('date-picker'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.done') }));
  };

  it('draws the fields, the zone from the device as a city, and the Terms unchecked', async () => {
    updateDraft({ role: 'student' });
    await inBothDirections(
      () => <OnboardProfile />,
      (_rendered, direction) => {
        expect(screen.getAllByText(said(direction, 'onboarding.profile.title'))).toHaveLength(2);
        expect(
          screen.getByLabelText(said(direction, 'onboarding.profile.displayName')),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'onboarding.profile.genderHint'))).toBeTruthy();
        const city = direction === 'rtl' ? 'القاهرة' : 'Cairo';
        expect(
          screen.getByText(said(direction, 'onboarding.profile.timeZoneFromDevice', { city })),
        ).toBeTruthy();
        expect(screen.getByRole('checkbox').props['accessibilityState']).toMatchObject({
          checked: false,
        });
        expect(
          screen.getByRole('button', { name: said(direction, 'common.action.continue') }).props[
            'accessibilityState'
          ],
        ).toMatchObject({ disabled: true });
        // A verified address needs no email field.
        expect(screen.queryByLabelText(said(direction, 'auth.field.email'))).toBeNull();
      },
    );
  });

  it('asks the city when the device is on UTC, which no person lives by', async () => {
    updateDraft({ role: 'student', timezone: null });
    await renderIn('rtl', <OnboardProfile />);
    expect(screen.getByText(ar('onboarding.profile.chooseTimeZone'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: ar('common.action.change') }));
    expect(mockNavigate).toHaveBeenCalledWith('/time-zone');
  });

  it('opens the Terms from the sentence', async () => {
    updateDraft({ role: 'student' });
    await renderIn('rtl', <OnboardProfile />);
    await fireEvent.press(screen.getByRole('link', { name: ar('onboarding.profile.termsLink') }));
    expect(mockNavigate).toHaveBeenCalledWith('/terms');
  });

  it('confirms the student and creates the account in one call, then lands it', async () => {
    updateDraft({ role: 'student' });
    mockApi.api.onboarding.complete.mutate.mockResolvedValue({
      ...tokens,
      landing: 'student_home',
    });
    await renderIn('rtl', <OnboardProfile />);
    await fillProfile();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.continue') }));
    expect(await screen.findByText(ar('onboarding.confirm.title'))).toBeTruthy();
    expect(screen.getByText(ar('onboarding.confirm.warning'))).toBeTruthy();
    // The gender on the sheet, beside the segmented the profile shows it in.
    expect(screen.getAllByText(ar('common.gender.female'))).toHaveLength(2);
    await fireEvent.press(
      screen.getByRole('button', { name: ar('onboarding.confirm.confirmStudent') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockApi.api.onboarding.complete.mutate).toHaveBeenCalledWith({
      onboardingToken: 'onboarding-1',
      role: 'student',
      displayName: 'أمل',
      gender: 'female',
      dateOfBirth: '2004-03-12',
      timezone: 'Africa/Cairo',
      termsVersion: '2026-10',
    });
    expect(mockApi.sessions.current()).toEqual(tokens);
    expect(getDraft()).toBeNull();
    // Created in Arabic, the language it was made in: nothing to set.
    expect(mockApi.api.account.setLanguage.mutate).not.toHaveBeenCalled();
    // The device's own zone: the launch report keeps following the device.
    expect(mockApi.api.account.setTimezone.mutate).not.toHaveBeenCalled();
  });

  // Review of B10b, round 1, finding 1: `complete` stamps no override, so a city chosen on this
  // step would be replaced by the device's at the launch report unless it is kept as the choice.
  it('keeps a city chosen on the step as the manual choice, before the account lands', async () => {
    updateDraft({ role: 'student', timezone: 'Asia/Riyadh' });
    mockApi.api.onboarding.complete.mutate.mockResolvedValue({
      ...tokens,
      landing: 'student_home',
    });
    let landedWhenSet: unknown = null;
    mockApi.api.account.setTimezone.mutate.mockImplementation(async () => {
      landedWhenSet = getSession();
      return undefined;
    });
    await renderIn('rtl', <OnboardProfile />);
    await fillProfile();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.continue') }));
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('onboarding.confirm.confirmStudent') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockApi.api.account.setTimezone.mutate).toHaveBeenCalledWith({
      timezone: 'Asia/Riyadh',
    });
    expect(landedWhenSet).toEqual({ kind: 'signed-out' });
  });

  it('sends the email account its password, and keeps an English choice on the account', async () => {
    startAs('email');
    updateDraft({ role: 'teacher' });
    mockApi.api.onboarding.complete.mutate.mockResolvedValue({
      ...tokens,
      landing: 'teacher_application',
    });
    await renderIn('ltr', <OnboardProfile />);
    const en = (key: MessageKey) => translate('en', key);
    await fireEvent.press(screen.getByRole('radio', { name: en('common.gender.male') }));
    await fireEvent.press(
      screen.getByRole('button', { name: en('onboarding.profile.dateOfBirth') }),
    );
    await fireEvent.press(screen.getByTestId('date-picker'));
    await fireEvent.press(screen.getByRole('button', { name: en('common.action.done') }));
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: en('common.action.continue') }));
    await fireEvent.press(
      await screen.findByRole('button', { name: en('onboarding.confirm.confirmTeacher') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockApi.api.onboarding.complete.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'teacher', gender: 'male', password: 'a long secret' }),
    );
    expect(mockApi.api.account.setLanguage.mutate).toHaveBeenCalledWith({ language: 'en' });
    setLocale('ar');
  });

  it('proves the address of a provider identity that reported none verified (FR-122)', async () => {
    startAs('provider', false);
    updateDraft({ role: 'student' });
    mockApi.api.onboarding.complete.mutate.mockResolvedValue({
      ...tokens,
      landing: 'student_home',
    });
    await renderIn('rtl', <OnboardProfile />);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.email')), 'amal@example.com');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.emailSignUp.sendCode') }));
    await waitFor(() =>
      expect(mockApi.api.onboarding.requestEmailCode.mutate).toHaveBeenCalledWith({
        onboardingToken: 'onboarding-1',
        email: 'amal@example.com',
      }),
    );
    await fireEvent.changeText(await screen.findByTestId('otp-input'), '654321');
    await fillProfile();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.continue') }));
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('onboarding.confirm.confirmStudent') }),
    );
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockApi.api.onboarding.complete.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'amal@example.com', emailCode: '654321' }),
    );
  });

  it('lands a creation refused as banned on the signed-out banned state (T097)', async () => {
    startAs('email');
    updateDraft({ role: 'student' });
    mockApi.api.onboarding.complete.mutate.mockRejectedValue(apiError('ACCOUNT_RESTRICTED'));
    await renderIn('rtl', <OnboardProfile />);
    await fillProfile();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.continue') }));
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('onboarding.confirm.confirmStudent') }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/banned'));
    expect(screen.queryByText(ar('common.state.actionError'))).toBeNull();
    expect(getSession()).toEqual({ kind: 'signed-out' });
    expect(mockApi.sessions.current()).toBeNull();
    // The token and the password go with the draft.
    expect(getDraft()).toBeNull();
  });

  it('says a failed creation on the sheet and creates nothing', async () => {
    updateDraft({ role: 'student' });
    mockApi.api.onboarding.complete.mutate.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', <OnboardProfile />);
    await fillProfile();
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.continue') }));
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('onboarding.confirm.confirmStudent') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(getSession()).toEqual({ kind: 'signed-out' });
    expect(mockApi.sessions.current()).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('/(auth)/banned');
    expect(getDraft()).not.toBeNull();
  });
});

describe('TimeZonePicker', () => {
  it('draws the search, the device row and the other cities in the language', async () => {
    await inBothDirections(
      () => withQueries(<TimeZonePicker />),
      (_rendered, direction) => {
        const city = direction === 'rtl' ? 'القاهرة' : 'Cairo';
        expect(screen.getByText(said(direction, 'onboarding.timeZone.title'))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'onboarding.timeZone.useDevice', { city })),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'onboarding.timeZone.otherCities'))).toBeTruthy();
      },
    );
  });

  it('finds a city by its name, says when none matches, and keeps the choice in the draft', async () => {
    await renderIn('rtl', withQueries(<TimeZonePicker />));
    await fireEvent.changeText(
      screen.getByPlaceholderText(ar('onboarding.timeZone.searchPlaceholder')),
      'زمبابوي-لا',
    );
    expect(screen.getByText(ar('onboarding.timeZone.noMatch'))).toBeTruthy();
    await fireEvent.changeText(
      screen.getByPlaceholderText(ar('onboarding.timeZone.searchPlaceholder')),
      'الرياض',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'الرياض' }));
    expect(getDraft()?.timezone).toBe('Asia/Riyadh');
    expect(mockNavigate).toHaveBeenCalledWith('back');
    expect(mockApi.api.account.setTimezone.mutate).not.toHaveBeenCalled();
  });

  it("sets a signed-in person's zone on the account (the manual override)", async () => {
    setSession({ kind: 'signed-in', landing: 'student_home' });
    await renderIn('ltr', withQueries(<TimeZonePicker />));
    await fireEvent.changeText(
      screen.getByPlaceholderText(translate('en', 'onboarding.timeZone.searchPlaceholder')),
      'Dubai',
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Dubai' }));
    await waitFor(() =>
      expect(mockApi.api.account.setTimezone.mutate).toHaveBeenCalledWith({
        timezone: 'Asia/Dubai',
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('back');
    setLocale('ar');
  });

  // T104: the 418 cities sorted by `localeCompare` froze the phone's JavaScript thread for 5.4 s
  // on Hermes, so the picker drew seconds after it opened. One `Intl.Collator` per language sorts
  // them once; a search filters the sorted list and never sorts again.
  const cityNames = (): string[] =>
    screen
      .getAllByRole('radio')
      .map((radio) => String(within(radio).getAllByText(/\S/)[0]?.props.children));
  const sortedIn = (locale: 'ar' | 'en'): string[] =>
    timeZoneCities.map((city) => city[locale]).sort(actualFormatters.nameOrder(locale));

  it('lists the cities in the order of each language (T104)', async () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      const locale = direction === 'rtl' ? 'ar' : 'en';
      const rendered = await renderIn(direction, withQueries(<TimeZonePicker />));
      const listed = cityNames().filter((name) => timeZoneCities.some((c) => c[locale] === name));
      expect(listed.length).toBeGreaterThan(1);
      expect(listed).toEqual(sortedIn(locale).slice(0, listed.length));
      await rendered.unmount();
    }
  });

  it('sorts with one collator per language, never `localeCompare`, and not again on a search (T104)', async () => {
    const compare = jest.spyOn(String.prototype, 'localeCompare');
    const collators = jest.mocked(nameOrder);
    collators.mockClear();
    await renderIn('ltr', withQueries(<TimeZonePicker />));
    for (const typed of ['D', 'Du', 'Dub']) {
      await fireEvent.changeText(
        screen.getByPlaceholderText(translate('en', 'onboarding.timeZone.searchPlaceholder')),
        typed,
      );
    }
    expect(compare).not.toHaveBeenCalled();
    expect(collators).toHaveBeenCalledTimes(1);
    expect(collators).toHaveBeenCalledWith('en');
    compare.mockRestore();
  });

  it('sorts again in the new language when the language changes (T104)', async () => {
    await renderIn('ltr', withQueries(<TimeZonePicker />));
    expect(cityNames()).toContain(sortedIn('en')[0]);
    await act(() => setLocale('ar'));
    const listed = cityNames().filter((name) => timeZoneCities.some((c) => c.ar === name));
    expect(listed).toEqual(sortedIn('ar').slice(0, listed.length));
    expect(listed[0]).toBe(sortedIn('ar')[0]);
  });
});

describe('Terms', () => {
  beforeEach(() => {
    process.env['EXPO_PUBLIC_API_URL'] = 'https://api.test/';
  });

  it("shows the served Terms in the person's language (FR-AUTH-11)", async () => {
    await renderIn('rtl', <Terms />);
    expect(screen.getByText(ar('onboarding.terms.title'))).toBeTruthy();
    expect(mockWebView?.uri).toBe('https://api.test/terms?lang=ar&theme=light');
    await renderIn('ltr', <Terms />);
    expect(mockWebView?.uri).toBe('https://api.test/terms?lang=en&theme=light');
    setLocale('ar');
  });

  it("asks for the served Terms in the app's scheme (T105)", async () => {
    await renderIn('rtl', <Terms />, 'dark');
    expect(mockWebView?.uri).toBe('https://api.test/terms?lang=ar&theme=dark');
    await renderIn('ltr', <Terms />, 'dark');
    expect(mockWebView?.uri).toBe('https://api.test/terms?lang=en&theme=dark');
    setLocale('ar');
  });

  it('says a failed load with a retry', async () => {
    await renderIn('rtl', <Terms />);
    await act(async () => mockWebView?.onError?.());
    expect(await screen.findByText(ar('common.state.loadError'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.retry') }));
    expect(screen.queryByText(ar('common.state.loadError'))).toBeNull();
  });
});
