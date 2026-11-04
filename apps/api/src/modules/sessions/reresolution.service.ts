// T048 (R-210, FR-370, FR-SESS-20, ADR 0009 D2–D3, ERD §15 rule 19): the recomputation of every
// scheduled session's cached instants, on the re-resolution job's one transaction, whose caller has
// deferred the two overlap constraints (`withDeferredSessionConstraints`).
//
// THE CACHE. A session's schedule is its requested local date, local start and zone (ADR 0009 D1);
// its start is that request resolved by `packages/time` (`resolveLocalDateTime`: a gap shifts it
// forward, a repeat takes the first), its end the start plus its enrollment's
// `snapshot_duration_minutes` of elapsed time (D2), read through booking's entry by the caller's
// `lengthsOf` (R-API-6). Every session still `scheduled` is read, whatever its cached start says,
// since that cache is the value that may be wrong (D3); only one whose cache differs is written, by
// a conditional update on its being still `scheduled`, so a session settled meanwhile keeps its
// instants and nothing is locked here (no lock order is touched: no row referencing an account is
// inserted).
//
// AN OVERLAP (rule 19). The constraints are checked at the commit, which names only the first
// conflict, so before the caller commits: every moved session that overlaps another session of its
// teacher or its student that the constraints count (any status but the two cancellations, not
// soft-deleted) is restored to its previous instants. Restoring one can make a moved session meet
// it, so the check runs again over the sessions still moved until none meets another; it ends,
// since each round restores one at least, and with every session restored the rows are as they
// were. The previous instants are held for the run only. The caller reports the restored ones.
import {
  addMinutes,
  resolveLocalDateTime,
  type LocalDate,
  type LocalTime,
  type TimeZoneId,
} from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';

/** A scheduled session as the run reads it: its schedule, parties and cached instants. */
export interface SessionSchedule {
  readonly id: string;
  readonly enrollmentId: string;
  readonly teacherUserId: string;
  readonly studentUserId: string;
  readonly scheduledDateLocal: LocalDate;
  readonly scheduledStartTimeLocal: LocalTime;
  readonly timezone: TimeZoneId;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}

/** A session's two cached instants, as the run writes them. */
export interface SessionInstants {
  readonly id: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}

/** A session's instants with the two accounts the overlap constraints compare. */
export interface PartiedSession extends SessionInstants {
  readonly teacherUserId: string;
  readonly studentUserId: string;
}

/** What the run asks of the `sessions` table, each on the caller's transaction. */
export interface ReresolutionStore {
  /** A page of the scheduled sessions in id order after `after`, at most `limit`. */
  scheduledAfter(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly SessionSchedule[]>;
  /** Writes each session's instants where it is still scheduled; answers the ids written. */
  setInstants(tx: Transaction, sessions: readonly SessionInstants[]): Promise<readonly string[]>;
  /**
   * The sessions the overlap constraints count that overlap one of `sessions` for its teacher or
   * its student, other than that session itself.
   */
  countedOverlapping(
    tx: Transaction,
    sessions: readonly PartiedSession[],
  ): Promise<readonly PartiedSession[]>;
}

/** Each enrollment's `snapshot_duration_minutes`, by id, as booking's entry reads it. */
export type SessionLengths = (
  tx: Transaction,
  enrollmentIds: readonly string[],
) => Promise<ReadonlyMap<string, number>>;

export interface ReresolutionDependencies {
  readonly store: ReresolutionStore;
  readonly lengthsOf: SessionLengths;
  /** How many sessions are read, and checked for an overlap, at a time. */
  readonly pageSize: number;
}

/** What the run left: the sessions it moved and kept moved, and those it restored, by id. */
export interface Reresolution {
  readonly moved: readonly string[];
  readonly restored: readonly string[];
}

/** A moved session: where it is now and where it was. */
interface Move {
  readonly next: PartiedSession;
  readonly previous: SessionInstants;
}

/** The session's instants as `packages/time` resolves its schedule, `minutes` long. */
function resolvedInstants(session: SessionSchedule, minutes: number): PartiedSession {
  const { startsAt } = resolveLocalDateTime({
    localDate: session.scheduledDateLocal,
    localTime: session.scheduledStartTimeLocal,
    timezone: session.timezone,
  });
  const scheduledStartAt = new Date(startsAt);
  return {
    id: session.id,
    teacherUserId: session.teacherUserId,
    studentUserId: session.studentUserId,
    scheduledStartAt,
    scheduledEndAt: new Date(addMinutes(scheduledStartAt, minutes)),
  };
}

function sameInstants(a: SessionInstants, b: SessionInstants): boolean {
  return (
    a.scheduledStartAt.getTime() === b.scheduledStartAt.getTime() &&
    a.scheduledEndAt.getTime() === b.scheduledEndAt.getTime()
  );
}

/** Recomputes one page; answers the moves written. A session whose enrollment is absent is left. */
async function movePage(
  tx: Transaction,
  page: readonly SessionSchedule[],
  { store, lengthsOf }: ReresolutionDependencies,
): Promise<Move[]> {
  const lengths = await lengthsOf(tx, [...new Set(page.map((session) => session.enrollmentId))]);
  const moves: Move[] = [];
  for (const session of page) {
    const minutes = lengths.get(session.enrollmentId);
    if (minutes === undefined) continue;
    const next = resolvedInstants(session, minutes);
    if (!sameInstants(next, session)) moves.push({ next, previous: session });
  }
  if (moves.length === 0) return moves;
  const written = new Set(
    await store.setInstants(
      tx,
      moves.map(({ next }) => next),
    ),
  );
  return moves.filter(({ next }) => written.has(next.id));
}

function meets(a: PartiedSession, b: PartiedSession): boolean {
  return (
    a.id !== b.id &&
    (a.teacherUserId === b.teacherUserId || a.studentUserId === b.studentUserId) &&
    a.scheduledStartAt < b.scheduledEndAt &&
    a.scheduledEndAt > b.scheduledStartAt
  );
}

/** Of `moves`, those whose new instants meet a counted session, asked a page at a time. */
async function overlappingMoves(
  tx: Transaction,
  moves: readonly Move[],
  { store, pageSize }: ReresolutionDependencies,
): Promise<Move[]> {
  const overlapping: Move[] = [];
  for (let start = 0; start < moves.length; start += pageSize) {
    const chunk = moves.slice(start, start + pageSize);
    const others = await store.countedOverlapping(
      tx,
      chunk.map(({ next }) => next),
    );
    overlapping.push(...chunk.filter(({ next }) => others.some((other) => meets(other, next))));
  }
  return overlapping;
}

/**
 * Recomputes every scheduled session's cached instants on `tx` and restores the moved ones that
 * would overlap (ERD §15 rule 19). Expects the caller to have deferred the overlap constraints on
 * `tx` and to commit, or roll back, the whole run; takes no lock.
 */
export async function reresolveScheduledSessions(
  tx: Transaction,
  dependencies: ReresolutionDependencies,
): Promise<Reresolution> {
  const { store, pageSize } = dependencies;
  let moves: Move[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await store.scheduledAfter(tx, after, pageSize);
    moves.push(...(await movePage(tx, page, dependencies)));
    if (page.length < pageSize) break;
    after = page.at(-1)?.id;
  }

  const restored: string[] = [];
  for (;;) {
    const overlapping = await overlappingMoves(tx, moves, dependencies);
    if (overlapping.length === 0) break;
    await store.setInstants(
      tx,
      overlapping.map(({ previous }) => ({
        id: previous.id,
        scheduledStartAt: previous.scheduledStartAt,
        scheduledEndAt: previous.scheduledEndAt,
      })),
    );
    const back = new Set(overlapping.map(({ next }) => next.id));
    restored.push(...back);
    moves = moves.filter(({ next }) => !back.has(next.id));
  }
  return { moved: moves.map(({ next }) => next.id), restored };
}
