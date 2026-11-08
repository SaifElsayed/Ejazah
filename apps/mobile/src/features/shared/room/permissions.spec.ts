// T018 of specs/004-sessions (FR-434, FR-433): the microphone's permission, granted on the
// pre-session screen. On Android the app asks for `RECORD_AUDIO` itself (React Native's
// `PermissionsAndroid`, no new package): granted, still undecided, refused once (it may ask again),
// or refused for good («Don't ask again»), when only the system settings can grant it; the screen
// reads it again when the person comes back from the settings. The camera is asked only when the
// person turns it on in the room (T019).
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus, Linking, PermissionsAndroid, Platform } from 'react-native';

import { askAccess, useMicrophone } from './permissions';

const { RECORD_AUDIO, CAMERA } = PermissionsAndroid.PERMISSIONS;
const { GRANTED, DENIED, NEVER_ASK_AGAIN } = PermissionsAndroid.RESULTS;

let check: jest.SpiedFunction<typeof PermissionsAndroid.check>;
let request: jest.SpiedFunction<typeof PermissionsAndroid.request>;
let appStateListeners: ((state: AppStateStatus) => void)[];

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(GRANTED);
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: AppStateStatus) => void);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter((each) => each !== listener);
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useMicrophone', () => {
  it('reads a permission already granted, asking nothing', async () => {
    check.mockResolvedValue(true);
    const { result } = await renderHook(() => useMicrophone());
    expect(result.current.access).toBe('granted');
    expect(check).toHaveBeenCalledWith(RECORD_AUDIO);
    expect(request).not.toHaveBeenCalled();
  });

  it('is undecided until the person asks, then granted', async () => {
    const { result } = await renderHook(() => useMicrophone());
    expect(result.current.access).toBe('undecided');
    await act(async () => {
      await result.current.ask();
    });
    expect(request).toHaveBeenCalledWith(RECORD_AUDIO);
    expect(result.current.access).toBe('granted');
  });

  it('says a refusal that can be asked again, and one only the settings can undo', async () => {
    request.mockResolvedValueOnce(DENIED).mockResolvedValueOnce(NEVER_ASK_AGAIN);
    const { result } = await renderHook(() => useMicrophone());
    await act(async () => {
      await result.current.ask();
    });
    expect(result.current.access).toBe('denied');
    await act(async () => {
      await result.current.ask();
    });
    expect(result.current.access).toBe('blocked');
  });

  it('opens the system settings, and reads the permission again on coming back', async () => {
    request.mockResolvedValue(NEVER_ASK_AGAIN);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { result, unmount } = await renderHook(() => useMicrophone());
    await act(async () => {
      await result.current.ask();
    });
    expect(result.current.access).toBe('blocked');
    await act(async () => {
      result.current.openSettings();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
    check.mockResolvedValue(true);
    await act(async () => {
      for (const listener of appStateListeners) listener('active');
      await Promise.resolve();
    });
    expect(result.current.access).toBe('granted');
    await unmount();
    expect(appStateListeners).toEqual([]);
  });

  it('leaves the asking to the system outside Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { result } = await renderHook(() => useMicrophone());
    expect(result.current.access).toBe('granted');
    expect(check).not.toHaveBeenCalled();
  });
});

describe('askAccess', () => {
  it('asks Android for the camera', async () => {
    request.mockResolvedValue(DENIED);
    expect(await askAccess('camera')).toBe('denied');
    expect(request).toHaveBeenCalledWith(CAMERA);
  });
});
