// T008 of specs/005-certification (FR-606; R-401, R-402; B46 Q6 (a), Q-B1 (a), the owner's word of
// 2026-11-17): certification's render store, what the worker's `render-certificate` job reads and
// writes through the module's entry (R-API-6). It reaches certification's own tables only, `ijazahs`
// and `ijazah_requests`; the parties' genders and the subject's names come through identity's and
// catalog's entries, in the job.
//
// THE SOURCE is read outside any transaction, before the render: the printed fields, the chain, the
// dates, the generation and whether it is rendered, and the request's signature copy key (kept after
// approval for the re-render, B46 Q14). The client's soft-delete extension leaves a deleted ijazah
// out, so the job meets it as not found.
//
// THE MARK (Q6 (a)). On the job's transaction, the ijazah's row is locked (`lockRows`, T006's
// `kernel.md` row: the ijazah last), then its generation, `rendered_at` and key are read under the
// lock (rule 1). Only when the payload's generation is still the row's, and not yet rendered, are
// `certificate_storage_key` and `rendered_at` set; the previous key is answered so the job removes
// that file after the commit. An older generation writes nothing and is answered with the row's own
// generation and key, the newer PDF's, which the job never removes; a generation already rendered
// writes nothing (a second run, R-API-14).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

/** What the job prints and decides on, read from the ijazah and its request. */
export interface RenderSource {
  readonly ijazahId: string;
  readonly requestId: string | null;
  readonly studentUserId: string;
  readonly teacherUserId: string;
  readonly subjectId: string;
  readonly language: 'ar' | 'en';
  readonly certificateNumber: string;
  readonly studentNamePrinted: string;
  readonly teacherNamePrinted: string;
  readonly riwayaPrinted: string;
  readonly tariqPrinted: string | null;
  /** The frozen chain as stored (jsonb); the job checks its shape. */
  readonly chainSnapshot: unknown;
  readonly completionDate: Date | null;
  readonly grantedAt: Date;
  readonly renderGeneration: number;
  readonly renderedAt: Date | null;
  /** The request's own copy of the teacher's signature; null when there is none. */
  readonly signatureStorageKey: string | null;
}

/** One generation's rendered PDF, to be recorded on the ijazah. */
export interface RenderedMark {
  readonly ijazahId: string;
  readonly generation: number;
  readonly storageKey: string;
  readonly at: Date;
}

export type MarkOutcome =
  | { readonly outcome: 'written'; readonly previousKey: string }
  | { readonly outcome: 'already_rendered' }
  | {
      readonly outcome: 'stale_generation';
      readonly currentGeneration: number;
      readonly currentKey: string;
    }
  | { readonly outcome: 'not_found' };

/** The ijazah's render source, or null for an unknown or deleted one. */
export async function renderSourceOf(
  db: Pick<Transaction, 'ijazah'>,
  ijazahId: string,
): Promise<RenderSource | null> {
  const row = await db.ijazah.findUnique({
    where: { id: ijazahId },
    select: {
      id: true,
      requestId: true,
      studentUserId: true,
      teacherUserId: true,
      subjectId: true,
      language: true,
      certificateNumber: true,
      studentNamePrinted: true,
      teacherNamePrinted: true,
      riwayaPrinted: true,
      tariqPrinted: true,
      chainSnapshot: true,
      completionDate: true,
      grantedAt: true,
      renderGeneration: true,
      renderedAt: true,
      request: { select: { signatureStorageKey: true } },
    },
  });
  if (row === null) return null;
  const { id, request, ...rest } = row;
  return { ijazahId: id, ...rest, signatureStorageKey: request?.signatureStorageKey ?? null };
}

/** Locks the ijazah's row, then reads its render state under the lock (rule 1). */
async function lockRenderState(tx: Transaction, ijazahId: string) {
  await lockRows(tx, 'ijazahs', [ijazahId]);
  return tx.ijazah.findUnique({
    where: { id: ijazahId },
    select: { renderGeneration: true, renderedAt: true, certificateStorageKey: true },
  });
}

/** Records one generation's PDF when that generation is still the row's and not yet rendered. */
export async function markRendered(tx: Transaction, mark: RenderedMark): Promise<MarkOutcome> {
  const state = await lockRenderState(tx, mark.ijazahId);
  if (state === null) return { outcome: 'not_found' };
  if (state.renderGeneration !== mark.generation) {
    return {
      outcome: 'stale_generation',
      currentGeneration: state.renderGeneration,
      currentKey: state.certificateStorageKey,
    };
  }
  if (state.renderedAt !== null) return { outcome: 'already_rendered' };
  await tx.ijazah.update({
    where: { id: mark.ijazahId },
    data: { certificateStorageKey: mark.storageKey, renderedAt: mark.at },
  });
  return { outcome: 'written', previousKey: state.certificateStorageKey };
}
