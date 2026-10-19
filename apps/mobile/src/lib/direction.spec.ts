// T031: direction follows the locale (FR-203, R-MOBILE-5, R-MOBILE-14). The native layout
// direction is fixed per process, so a change is written to I18nManager and the app reloads.
import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import {
  DirectionContext,
  directionOf,
  mirrors,
  syncNativeDirection,
  useDirection,
} from './direction';

describe('direction', () => {
  it('is right-to-left for Arabic and left-to-right for English', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('writes a changed direction to the native layout and reloads once', () => {
    const native = { isRTL: false, allowRTL: jest.fn(), forceRTL: jest.fn() };
    const reload = jest.fn(async () => undefined);
    expect(syncNativeDirection('rtl', native, reload)).toBe(true);
    expect(native.allowRTL).toHaveBeenCalledWith(true);
    expect(native.forceRTL).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a native layout that already matches alone', () => {
    const native = { isRTL: true, allowRTL: jest.fn(), forceRTL: jest.fn() };
    const reload = jest.fn(async () => undefined);
    expect(syncNativeDirection('rtl', native, reload)).toBe(false);
    expect(native.forceRTL).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('mirrors only the directional icons, and only right-to-left', () => {
    expect(mirrors('chevron-left', 'rtl')).toBe(true);
    expect(mirrors('arrow-left', 'rtl')).toBe(true);
    expect(mirrors('chevron-left', 'ltr')).toBe(false);
    expect(mirrors('mail', 'rtl')).toBe(false);
  });

  it('useDirection reads the provided direction', async () => {
    for (const direction of ['rtl', 'ltr'] as const) {
      const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(DirectionContext.Provider, { value: direction }, children);
      const { result } = await renderHook(() => useDirection(), { wrapper });
      expect(result.current.direction).toBe(direction);
      expect(result.current.isRTL).toBe(direction === 'rtl');
      expect(result.current.mirrors('chevron-right')).toBe(direction === 'rtl');
    }
  });
});
