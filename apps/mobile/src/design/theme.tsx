// T031: the theme and direction providers (ADR 0020 D7, R-MOBILE-4/5). A component asks the theme
// for a semantic colour (`useTheme().color.primary`), never the palette or a literal; light or
// dark follows the system unless a surface is drawn on one scheme (the live session). The
// direction follows the active locale (lib/direction.ts). The provider also sets the scheme's CSS
// variables, so a NativeWind colour class follows the same scheme (`colorVariables`).
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { vars } from 'nativewind';

import { useLocale } from '../i18n';
import {
  type Direction,
  DirectionContext,
  directionOf,
  syncNativeDirection,
} from '../lib/direction';
import { type ColorScheme, type ColorToken, tokens } from './tokens';

export interface Theme {
  readonly scheme: ColorScheme;
  /** The semantic colours of the scheme in force. */
  readonly color: Readonly<Record<ColorToken, string>>;
}

const themeOf = (scheme: ColorScheme): Theme => ({ scheme, color: tokens.color[scheme] });

const ThemeContext = createContext<Theme>(themeOf('light'));

/**
 * The CSS variables a Tailwind colour class reads (`bg-primary` is `var(--color-primary)`,
 * design/tailwind.config.js), with the values of `scheme`.
 */
export function colorVariables(
  scheme: ColorScheme,
): Readonly<Record<`--color-${ColorToken}`, string>> {
  return Object.fromEntries(
    Object.entries(tokens.color[scheme]).map(([name, value]) => [`--color-${name}`, value]),
  ) as Record<`--color-${ColorToken}`, string>;
}

const variablesOf = { light: vars(colorVariables('light')), dark: vars(colorVariables('dark')) };

/** The system's scheme, or `scheme` when the surface is drawn on one. */
export function ThemeProvider({
  scheme,
  children,
}: {
  readonly scheme?: ColorScheme;
  readonly children: ReactNode;
}) {
  const system = useColorScheme();
  const chosen: ColorScheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const theme = useMemo(() => themeOf(chosen), [chosen]);
  return (
    <ThemeContext.Provider value={theme}>
      <View style={[styles.fill, variablesOf[chosen]]}>{children}</View>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

/** The theme in force. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * The direction of the active locale, written to the native layout when it changes (`sync`, which
 * reloads the app once; injectable for tests).
 */
export function DirectionProvider({
  sync = syncNativeDirection,
  children,
}: {
  readonly sync?: (direction: Direction) => boolean;
  readonly children: ReactNode;
}) {
  const direction = directionOf(useLocale());
  useEffect(() => {
    sync(direction);
  }, [direction, sync]);
  return <DirectionContext.Provider value={direction}>{children}</DirectionContext.Provider>;
}
