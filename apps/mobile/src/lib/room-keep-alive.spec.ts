// T019 of specs/004-sessions (the owner's conditions of 2026-11-09): the service that keeps the JS
// timers alive while the screen is shared. Starting waits until the headless task runs; ending
// finishes the task and stops the service; a build without the module does nothing.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppRegistry } from 'react-native';

const mockNative = { start: jest.fn(), stop: jest.fn() };
let mockAvailable = true;
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => (mockAvailable ? mockNative : null),
}));

type Task = () => Promise<void>;

/** The module afresh, as the process loads it, with the task it registered. */
function load() {
  let task: Task = () => Promise.resolve();
  jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation((_key, provider) => {
    task = provider() as unknown as Task;
  });
  let loaded: typeof import('./room-keep-alive') | undefined;
  jest.isolateModules(() => {
    loaded = require('./room-keep-alive');
  });
  if (loaded === undefined) throw new Error('not loaded');
  loaded.registerRoomKeepAlive();
  return { keepAlive: loaded, runTask: () => task() };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAvailable = true;
  mockNative.start.mockReset();
  mockNative.stop.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the room keep-alive', () => {
  it('registers one headless task under the service’s name', () => {
    load();
    expect(AppRegistry.registerHeadlessTask).toHaveBeenCalledTimes(1);
    expect((AppRegistry.registerHeadlessTask as unknown as jest.Mock).mock.calls[0]?.[0]).toBe(
      'RoomKeepAlive',
    );
  });

  it('starts the service with the notification’s words and resolves once the task runs', async () => {
    const { keepAlive, runTask } = load();
    let started = false;
    const starting = keepAlive.startRoomKeepAlive('title', 'text').then(() => {
      started = true;
    });
    expect(mockNative.start).toHaveBeenCalledWith('title', 'text');
    await jest.advanceTimersByTimeAsync(100);
    expect(started).toBe(false);
    void runTask();
    await starting;
    expect(started).toBe(true);
  });

  it('refuses when the task does not run in time', async () => {
    const { keepAlive } = load();
    const starting = keepAlive.startRoomKeepAlive('title', 'text');
    const outcome = expect(starting).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(3_000);
    await outcome;
  });

  it('refuses when the service cannot be started', async () => {
    mockNative.start.mockImplementation(() => {
      throw new Error('not allowed');
    });
    const { keepAlive } = load();
    await expect(keepAlive.startRoomKeepAlive('title', 'text')).rejects.toThrow('not allowed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('finishes the task and stops the service', async () => {
    const { keepAlive, runTask } = load();
    const starting = keepAlive.startRoomKeepAlive('title', 'text');
    let finished = false;
    void runTask().then(() => {
      finished = true;
    });
    await starting;
    keepAlive.stopRoomKeepAlive();
    await jest.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    expect(mockNative.stop).toHaveBeenCalledTimes(1);
  });

  it('finishes at once a task that no start is waiting for', async () => {
    const { runTask } = load();
    await expect(runTask()).resolves.toBeUndefined();
  });

  it('finishes at once a task that arrives after the wait ran out', async () => {
    const { keepAlive, runTask } = load();
    const starting = keepAlive.startRoomKeepAlive('title', 'text');
    const outcome = expect(starting).rejects.toThrow();
    await jest.advanceTimersByTimeAsync(3_000);
    await outcome;
    await expect(runTask()).resolves.toBeUndefined();
  });

  it('finishes at once a task that arrives after the stop, and releases the start waiting', async () => {
    const { keepAlive, runTask } = load();
    const starting = keepAlive.startRoomKeepAlive('title', 'text');
    keepAlive.stopRoomKeepAlive();
    await expect(starting).resolves.toBeUndefined();
    await expect(runTask()).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does nothing in a build without the module', async () => {
    mockAvailable = false;
    const { keepAlive } = load();
    await expect(keepAlive.startRoomKeepAlive('title', 'text')).resolves.toBeUndefined();
    keepAlive.stopRoomKeepAlive();
    expect(mockNative.start).not.toHaveBeenCalled();
    expect(mockNative.stop).not.toHaveBeenCalled();
  });
});
