// T031: the theme and direction providers (ADR 0020 D7, R-MOBILE-4/5). Light or dark follows the
// system; the direction follows the active locale.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { setLocale } from '../i18n';
import { useDirection } from '../lib/direction';
import {
  DirectionProvider,
  ThemeProvider,
  colorVariables,
  navigationTheme,
  useTheme,
} from './theme';
import { tokens } from './tokens';

// The system's scheme, as React Native's hook reads it from the Appearance module.
const mockSystemScheme = jest.fn<() => 'light' | 'dark' | null>(() => 'light');
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockSystemScheme(),
}));

beforeEach(() => setLocale('ar'));
afterEach(() => {
  mockSystemScheme.mockReset();
  mockSystemScheme.mockReturnValue('light');
});

describe('ThemeProvider', () => {
  it('gives the light scheme by default', async () => {
    const { result } = await renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.scheme).toBe('light');
    expect(result.current.color.primary).toBe(tokens.color.light.primary);
  });

  it('follows the system to dark', async () => {
    mockSystemScheme.mockReturnValue('dark');
    const { result } = await renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.scheme).toBe('dark');
    expect(result.current.color.bg).toBe(tokens.color.dark.bg);
  });

  it('takes a fixed scheme for a surface drawn on one (the live session)', async () => {
    const { result } = await renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider scheme="dark">{children}</ThemeProvider>
      ),
    });
    expect(result.current.scheme).toBe('dark');
  });
});

describe('colorVariables', () => {
  it('names every semantic colour of the scheme as the variable a Tailwind class reads', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const variables = colorVariables(scheme);
      expect(Object.keys(variables)).toHaveLength(Object.keys(tokens.color[scheme]).length);
      expect(variables['--color-primary']).toBe(tokens.color[scheme].primary);
      expect(variables['--color-on-primary-muted']).toBe(tokens.color[scheme]['on-primary-muted']);
    }
  });
});

// T078: the navigators draw each screen's card and their own container in the navigation theme's
// `background`; react-navigation's default is a light grey, which showed behind the system bars of
// every pushed screen in the dark scheme.
describe('navigationTheme', () => {
  it("gives the navigators each scheme's background, never react-navigation's default", () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = navigationTheme(scheme);
      expect(theme.dark).toBe(scheme === 'dark');
      expect(theme.colors.background).toBe(tokens.color[scheme].bg);
      expect(theme.colors.card).toBe(tokens.color[scheme].bg);
      expect(theme.colors.text).toBe(tokens.color[scheme].text);
      expect(theme.colors.border).toBe(tokens.color[scheme].border);
      expect(theme.colors.primary).toBe(tokens.color[scheme].primary);
      expect(theme.colors.notification).toBe(tokens.color[scheme].danger);
    }
  });

  it('keeps one theme object per scheme, so the navigators do not redraw on every render', () => {
    expect(navigationTheme('dark')).toBe(navigationTheme('dark'));
    expect(navigationTheme('light')).not.toBe(navigationTheme('dark'));
  });
});

describe('DirectionProvider', () => {
  it('derives the direction from the active locale and syncs the native layout', async () => {
    const sync = jest.fn((_direction: 'rtl' | 'ltr') => false);
    const { result } = await renderHook(() => useDirection(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DirectionProvider sync={sync}>{children}</DirectionProvider>
      ),
    });
    expect(result.current.direction).toBe('rtl');
    expect(sync).toHaveBeenLastCalledWith('rtl');
    await act(async () => setLocale('en'));
    expect(result.current.direction).toBe('ltr');
    expect(sync).toHaveBeenLastCalledWith('ltr');
  });
});
