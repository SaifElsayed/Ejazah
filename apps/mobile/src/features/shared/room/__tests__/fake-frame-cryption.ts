// 004:T084 (R1b): the frame cryptors' reports as the room's specs see them (`frame-cryption.ts`):
// the native half exists only in the development build, so a spec says what a cryptor reports.
import { jest } from '@jest/globals';

import type { CryptionChange } from '../frame-cryption';

type Watcher = (change: CryptionChange) => void;

/** Every watch the code under test holds now. */
export const watchers = new Set<Watcher>();

export const watchFrameCryption: jest.Mock<(onChange: Watcher) => () => void> = jest.fn(
  (onChange: Watcher) => {
    watchers.add(onChange);
    return () => {
      watchers.delete(onChange);
    };
  },
);

/** A frame cryptor reports `state` for `participantId`'s track. */
export function report(participantId: string, frameCryptorId: string, state: string): void {
  for (const watcher of [...watchers]) watcher({ participantId, frameCryptorId, state });
}

export function resetCryption(): void {
  watchers.clear();
  watchFrameCryption.mockClear();
}
