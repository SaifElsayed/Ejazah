// T058 (FR-150, FR-155): what the three application steps hold on the device until the
// application is sent. The documents are uploaded as they are picked, so the draft holds their ids
// with the name and size its rows show; nothing else is sent until `submit` (a first application,
// keyed by the draft's idempotency key, so a retry after a lost answer is not a second
// application) or `reapply` (after a rejection). The draft lives in memory, like the onboarding's:
// a relaunch starts the steps again, and the uploaded documents nothing points at are swept by the
// server (T093).
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';

import type { UploadedPdf } from '../../shared/documents';

export interface ApplicationDraft {
  /** A first application, or a new one after a rejection. */
  readonly mode: 'submit' | 'reapply';
  /** `teacher.application.submit`'s key, one per draft (FR-106). */
  readonly idempotencyKey: string;
  readonly subjectIds: readonly string[];
  readonly qualification: string;
  readonly identityType: 'national_id' | 'passport';
  readonly identity: UploadedPdf | undefined;
  /** One ijazah PDF per chosen subject, by subject id. */
  readonly ijazahs: Readonly<Record<string, UploadedPdf>>;
}

function fresh(mode: ApplicationDraft['mode']): ApplicationDraft {
  return {
    mode,
    idempotencyKey: Crypto.randomUUID(),
    subjectIds: [],
    qualification: '',
    identityType: 'national_id',
    identity: undefined,
    ijazahs: {},
  };
}

let current: ApplicationDraft = fresh('submit');
const listeners = new Set<() => void>();

function emit(next: ApplicationDraft): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Starts the steps again: a first application, or a reapplication after a rejection. */
export function startApplication(mode: ApplicationDraft['mode']): void {
  emit(fresh(mode));
}

export function updateApplication(patch: Partial<Omit<ApplicationDraft, 'idempotencyKey'>>): void {
  emit({ ...current, ...patch });
}

/** Forgets the draft once the application is sent. */
export function clearApplication(): void {
  emit(fresh('submit'));
}

export function getApplication(): ApplicationDraft {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApplicationDraft(): ApplicationDraft {
  return useSyncExternalStore(subscribe, getApplication, getApplication);
}

/** The draft's subjects that have their ijazah, and whether every chosen one has. */
export function ijazahsComplete(draft: ApplicationDraft): boolean {
  return (
    draft.subjectIds.length > 0 && draft.subjectIds.every((id) => draft.ijazahs[id] !== undefined)
  );
}
