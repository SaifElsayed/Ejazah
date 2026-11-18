// T014 of specs/005-certification (Q-G4 (a), the owner's decision of 2026-11-18; SC-604; R-402;
// `C:\Users\amrkn\Documents\ejazah-tools\b46\certificate-text.md:21-29`: the render reads both
// parties' declared genders at render): `rerenderOfParty(tx, userId)`, called last on a gender
// correction's (T014) and a fraud ban's (T015) transaction, after the person's gender was written.
//
// Each ijazah of the person, as teacher or student, not signed off and not revoked: read with no
// lock, then locked (`lockIjazahs`, `ijazahs` last in the kernel's one order), read again under the
// locks, its generation raised and its rendering cleared, and its new generation enqueued
// (`render-certificate`) once the caller's transaction has committed (`afterCommitDo`), never before:
// a rollback renders nothing. A signed-off ijazah keeps the words it was signed off with (SC-604); a
// revoked one is left. Open requests carry no gender, and the ijazahs of the enrollments the
// correction ended are left to the administrator (Q-G4b (a)).
//
// ⚠️ Automatic: the unsigned PDF is replaced by the job (T008's removal); a later re-render or the
// administrator's `ijazahs.rerender` can render it again. A lost enqueue leaves the ijazah unrendered
// and visible as such, logged `enqueue_failed` by ids. A caller that bound no after-commit list is
// refused before any write, so a re-render is never lost silently (T032's rule). Lines: ids and a
// reason only, never a gender.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { RenderQueue } from './ijazah-decision.service.js';
import { lockIjazahs, rerenderUnsigned, unsignedIjazahsOfParty } from './ijazahs.repository.js';

/** What the re-render reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface PartyRerenderStore {
  unsignedOfParty(tx: Transaction, userId: string): Promise<readonly string[]>;
  lockIjazahs(tx: Transaction, ids: readonly string[]): Promise<void>;
  rerender(
    tx: Transaction,
    ids: readonly string[],
  ): Promise<readonly { readonly id: string; readonly generation: number }[]>;
}

export const partyRerenderStore: PartyRerenderStore = {
  unsignedOfParty: unsignedIjazahsOfParty,
  lockIjazahs,
  rerender: rerenderUnsigned,
};

export interface PartyRerenderDependencies {
  /** `render-certificate`, the approval's queue (`main.ts`'s `ijazahRenders`). */
  readonly renders: RenderQueue;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  readonly store?: PartyRerenderStore;
}

export interface PartyRerender {
  /** The person's unsigned ijazahs re-rendered after the caller's commit; their new generations. */
  rerenderOfParty(
    tx: Transaction,
    userId: string,
  ): Promise<readonly { readonly id: string; readonly generation: number }[]>;
}

export function createPartyRerender({
  renders,
  log,
  store = partyRerenderStore,
}: PartyRerenderDependencies): PartyRerender {
  return {
    rerenderOfParty: async (tx, userId) => {
      const issued = await store.unsignedOfParty(tx, userId);
      if (issued.length === 0) return [];
      const list = publisherOn(tx);
      if (list?.afterCommitDo === undefined) {
        log.info({ userId, reason: 'no_after_commit_list' }, 'An ijazah re-render was refused');
        throw new Error(
          'An ijazah is re-rendered on a transaction its caller bound an after-commit list to (T032, R-API-13), so its new generation is rendered only once the change has committed.',
        );
      }
      await store.lockIjazahs(tx, issued);
      const rerendered = await store.rerender(tx, issued);
      for (const { id, generation } of rerendered) {
        log.info(
          { ijazahId: id, userId, generation, reason: 'gender_corrected' },
          'An ijazah was re-rendered',
        );
      }
      if (rerendered.length > 0) {
        list.afterCommitDo(() => {
          void Promise.all(
            rerendered.map(async ({ id, generation }) => {
              try {
                await renders.enqueue(id, generation);
              } catch {
                log.warn(
                  { ijazahId: id, generation, reason: 'enqueue_failed' },
                  "A re-rendered ijazah's rendering could not be queued",
                );
              }
            }),
          );
        });
      }
      return rerendered;
    },
  };
}
