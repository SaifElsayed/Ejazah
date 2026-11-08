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
// a conditional update on its being still `scheduled`.
//
// THE LOCKS (T014; contracts/kernel.md's `reresolve-session-instants` row; the owner's decision of
// 2026-11-06 on the fourth analysis, L1). The sessions whose instants differ are found by a read
// with no lock, a page at a time. Then, before any is written, their `enrollments` are locked in one
// call and those `sessions` in one call, each in id order: the evaluation's order
// (`evaluate-sessions` locks the enrollment, then the session), since each `instants_reresolved`
// row below takes a key-share lock on its enrollment (`003:T005`'s rules) and the run writes the
// session. Each is read again under the locks and recomputed, so one settled, cancelled or moved
// meanwhile is left as it now is; the enrollment's length is the one read before the locks, a
// snapshot that never changes.
//
// AN OVERLAP (rule 19). The constraints are checked at the commit, which names only the first
// conflict, so before the caller commits: every moved session that overlaps another session of its
// teacher or its student that the constraints count (any status but the two cancellations, not
// soft-deleted) is restored to its previous instants. Restoring one can make a moved session meet
// it, so the check runs again over the sessions still moved until none meets another; it ends,
// since each round restores one at least, and with every session restored the rows are as they
// were. The previous instants are held for the run only. The caller reports the restored ones.
//
// THE RECORD (T014; research R-323, GAP-6). On the run's one transaction, through T004's writer,
// one `session_events` row `instants_reresolved` per session the run kept moved and per session it
// kept back, `previous_start_at` the start it had before the run (the one a session kept back still
// keeps), at the transaction's instant by the database's clock; a refused commit writes none, and a
// later run that keeps the same session back again writes another.
import {
  addMinutes,
  resolveLocalDateTime,
  type LocalDate,
  type LocalTime,
  type TimeZoneId,
} from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SessionEventRecord } from './session-events.repository.js';

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
  /** A page of the scheduled sessions in id order after `after`, at most `limit`; no lock. */
  scheduledAfter(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly SessionSchedule[]>;
  /** Locks the enrollments' rows, `FOR UPDATE`, in id order, in one statement. */
  lockEnrollments(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** Locks the sessions' rows, `FOR UPDATE`, in id order, in one statement. */
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** Of `ids`, those still scheduled, in id order, read under the caller's locks. */
  scheduledAmong(tx: Transaction, ids: readonly string[]): Promise<readonly SessionSchedule[]>;
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
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
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
  /** The database's clock on the run's transaction, the instant of its rows (`clockTimestamp`). */
  readonly clock: (tx: Transaction) => Promise<Date>;
}

/** What the run left: the sessions it moved and kept moved, and those it restored, by id. */
export interface Reresolution {
  readonly moved: readonly string[];
  readonly restored: readonly string[];
}

/** A moved session: where it is now and where it was. */
interface Move {
  readonly next: PartiedSession;
  readonly previous: SessionSchedule;
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

/** Of `sessions`, those whose cache differs from their resolution; one with no length is left. */
function movesOf(
  sessions: readonly SessionSchedule[],
  lengths: ReadonlyMap<string, number>,
): Move[] {
  const moves: Move[] = [];
  for (const session of sessions) {
    const minutes = lengths.get(session.enrollmentId);
    if (minutes === undefined) continue;
    const next = resolvedInstants(session, minutes);
    if (!sameInstants(next, session)) moves.push({ next, previous: session });
  }
  return moves;
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

/** `ids` once each, in id order. */
const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** The read with no lock: every scheduled session whose instants differ, and the lengths read. */
async function differingSessions(
  tx: Transaction,
  { store, lengthsOf, pageSize }: ReresolutionDependencies,
): Promise<{ readonly sessions: SessionSchedule[]; readonly lengths: Map<string, number> }> {
  const sessions: SessionSchedule[] = [];
  const lengths = new Map<string, number>();
  let after: string | undefined;
  for (;;) {
    const page = await store.scheduledAfter(tx, after, pageSize);
    if (page.length > 0) {
      const read = await lengthsOf(tx, [...new Set(page.map((session) => session.enrollmentId))]);
      for (const [id, minutes] of read) lengths.set(id, minutes);
      sessions.push(...movesOf(page, lengths).map(({ previous }) => previous));
    }
    if (page.length < pageSize) break;
    after = page.at(-1)?.id;
  }
  return { sessions, lengths };
}

/**
 * Recomputes every scheduled session's cached instants on `tx` and restores the moved ones that
 * would overlap (ERD §15 rule 19), with one `instants_reresolved` row per session moved or kept
 * back. Expects the caller to have deferred the overlap constraints on `tx` and to commit, or roll
 * back, the whole run; takes the locks this file's head names.
 */
export async function reresolveScheduledSessions(
  tx: Transaction,
  dependencies: ReresolutionDependencies,
): Promise<Reresolution> {
  const { store, pageSize, clock } = dependencies;
  const differing = await differingSessions(tx, dependencies);
  if (differing.sessions.length === 0) return { moved: [], restored: [] };

  const ids = sortedUnique(differing.sessions.map(({ id }) => id));
  await store.lockEnrollments(
    tx,
    sortedUnique(differing.sessions.map(({ enrollmentId }) => enrollmentId)),
  );
  await store.lockSessions(tx, ids);

  let moves: Move[] = [];
  for (let start = 0; start < ids.length; start += pageSize) {
    const fresh = await store.scheduledAmong(tx, ids.slice(start, start + pageSize));
    const chunk = movesOf(fresh, differing.lengths);
    if (chunk.length === 0) continue;
    const written = new Set(
      await store.setInstants(
        tx,
        chunk.map(({ next }) => next),
      ),
    );
    moves.push(...chunk.filter(({ next }) => written.has(next.id)));
  }

  const kept: Move[] = [];
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
    kept.push(...overlapping);
    moves = moves.filter(({ next }) => !back.has(next.id));
  }

  const recorded = [...kept, ...moves].toSorted((a, b) => (a.previous.id < b.previous.id ? -1 : 1));
  if (recorded.length > 0) {
    const occurredAt = await clock(tx);
    await store.recordEvents(
      tx,
      recorded.map(({ previous }) => ({
        enrollmentId: previous.enrollmentId,
        sessionId: previous.id,
        kind: 'instants_reresolved',
        previousStartAt: previous.scheduledStartAt,
        occurredAt,
      })),
    );
  }
  return { moved: moves.map(({ next }) => next.id), restored: kept.map(({ next }) => next.id) };
}
