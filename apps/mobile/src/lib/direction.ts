// T031: the layout direction (FR-203, R-MOBILE-5, R-MOBILE-14). Arabic is right-to-left and
// English left-to-right. Components read the direction from `useDirection()` and lay out with
// start and end only; a directional icon is mirrored through `mirrors`, never by hand.
//
// React Native fixes the native layout direction per process (`I18nManager`): a change of locale
// that changes the direction is written there and the app reloads once (`syncNativeDirection`,
// run by `DirectionProvider` in design/theme.tsx).
import { reloadAppAsync } from 'expo';
import { createContext, useContext, useMemo } from 'react';
import { I18nManager } from 'react-native';

import { directionalIcons, type IconName } from '../design/icons';
import type { Locale } from '../i18n';

export type Direction = 'rtl' | 'ltr';

/** The direction a locale reads in. */
export function directionOf(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** The part of `I18nManager` the sync touches. */
export interface NativeDirection {
  readonly isRTL: boolean;
  allowRTL(allow: boolean): void;
  forceRTL(force: boolean): void;
}

/**
 * Writes `direction` to the native layout when it differs and reloads the app so every view is
 * laid out again; true when it did. A matching layout is left alone, so a reload never loops.
 */
export function syncNativeDirection(
  direction: Direction,
  native: NativeDirection = I18nManager,
  reload: () => Promise<void> = reloadApp,
): boolean {
  const rtl = direction === 'rtl';
  if (native.isRTL === rtl) return false;
  native.allowRTL(rtl);
  native.forceRTL(rtl);
  void reload();
  return true;
}

function reloadApp(): Promise<void> {
  return reloadAppAsync('The layout direction changed with the language.');
}

const DIRECTIONAL: ReadonlySet<IconName> = new Set(directionalIcons);

/** True when `icon` points along the reading direction and the layout is right-to-left. */
export function mirrors(icon: IconName, direction: Direction): boolean {
  return direction === 'rtl' && DIRECTIONAL.has(icon);
}

/** The direction in force; the native one until a provider says otherwise. */
export const DirectionContext = createContext<Direction>(I18nManager.isRTL ? 'rtl' : 'ltr');

/** The direction, and whether a given icon is mirrored in it. */
export function useDirection() {
  const direction = useContext(DirectionContext);
  return useMemo(
    () => ({
      direction,
      isRTL: direction === 'rtl',
      mirrors: (icon: IconName) => mirrors(icon, direction),
    }),
    [direction],
  );
}
