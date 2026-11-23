// 003:T105 (ADR 0025 D2, SRS DEC-81; the notes under T105): what the releases of a teacher's share
// are computed from, gathered for some enrollments in one read of each owner, and the due sweep that
// writes them. The rules are `share-release.rules.ts`'s, the amounts `packages/money`'s.
//
// THE OWNERS (R-API-6): the orders (006:T011: every paid one, with its kind) and the written
// releases are payments' own; the enrollment's parties, track, status and count, and (006:T011) its
// cancellation reason and programme, are booking's (`enrollmentsAmong`); its sessions' outcomes sessions'
// (`sessionsOfEnrollments`, a disputed one by its frozen outcome); its compensation cases and its
// open matters moderation's (`compensationCasesAmong`, `enrollmentsWithOpenMatterAmong`). Each read
// is bounded by the enrollments asked and takes no lock: a release is a record an administrator acts
// on by hand, and its once-only write is the database's unique (rule 62), not a lock.
//
// THE SWEEP. A page of the paid orders with a share at a time, in id order, each page's enrollments
// judged on one transaction, then each enrollment's due releases written on a transaction of its own
// (`INSERT … ON CONFLICT DO NOTHING`), its failure caught and reported on its own, so one bad row
// never stops the run. One info line per release written: its ids and its milestone, never an amount
// a name or a text. Run twice, or by two workers at once, it leaves one row per enrollment and
// milestone (R-API-14). A programme's enrollment, met on each page that holds one of its orders, is
// judged again there and writes nothing more (006:T011).
import type { EnrollmentSessionRow } from '../sessions/index.js';
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { enrollmentsAmong } from '../booking/index.js';
import {
  compensationCasesAmong,
  type EnrollmentCase,
  enrollmentsWithOpenMatterAmong,
} from '../moderation/index.js';
import {
  DISPUTE_WINDOW_SETTING,
  disputeWindowHours,
  makeupOriginsAmong,
  sessionsOfEnrollments,
} from '../sessions/index.js';
import {
  type DueRelease,
  insertDueReleases,
  type ReleaseRow,
  releasesOf,
  type ShareOrderRow,
  shareOrdersAfter,
  shareOrdersOf,
} from './share-release.repository.js';
import {
  type PlannedRelease,
  plannedReleases,
  programmeRowMissing,
  type ReleaseEnrollment,
  type ReleaseFacts,
  type ReleaseSession,
} from './share-release.rules.js';

/** What the releases are computed from, each read on the caller's transaction; faked in a spec. */
export interface ReleaseReads {
  /** 006:T011: each enrollment's paid orders with a share, oldest first. */
  shareOrdersOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ShareOrderRow[]>>;
  releasesOf(tx: Transaction, enrollmentIds: readonly string[]): Promise<readonly ReleaseRow[]>;
  /**
   * Booking's: each enrollment's parties, track, status and count, and (006:T011) its cancellation
   * reason and programme; an unknown one absent.
   */
  enrollmentsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReleaseEnrollment>>;
  /** Sessions': each enrollment's sessions by sequence number. */
  sessionsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentSessionRow[]>>;
  /** Moderation's: each enrollment's compensation cases, newest first. */
  casesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentCase[]>>;
  /** Moderation's: the enrollments with an open dispute, case or complaint. */
  openMattersAmong(tx: Transaction, enrollmentIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Sessions': each make-up's id to the id of the session it makes up (Q-B1-4 (a)). */
  makeupsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

/**
 * Booking's enrollments through its public entry, in one read (Q-B1-6 (a)), each with its
 * cancellation reason and its programme (006:T011, R-512).
 */
async function enrollmentsThroughBooking(
  tx: Transaction,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, ReleaseEnrollment>> {
  const rows = await enrollmentsAmong(tx, [...new Set(enrollmentIds)]);
  return new Map(
    rows.map(
      (row) =>
        [
          row.id,
          {
            enrollmentId: row.id,
            teacherUserId: row.teacherUserId,
            studentUserId: row.studentUserId,
            track: row.snapshotTrack,
            status: row.status,
            sessionCount: row.snapshotSessionCount,
            cancellationReason: row.cancellationReason,
            programme: row.programme,
          },
        ] as const,
    ),
  );
}

/** The reads over payments' own queries and the owners' entries (R-API-6). */
export const releaseReads: ReleaseReads = {
  shareOrdersOf,
  releasesOf,
  enrollmentsAmong: enrollmentsThroughBooking,
  sessionsAmong: sessionsOfEnrollments,
  casesAmong: compensationCasesAmong,
  openMattersAmong: enrollmentsWithOpenMatterAmong,
  makeupsAmong: makeupOriginsAmong,
};

/**
 * The enrollment's sessions as the rules read them: a disputed one by its frozen outcome, as
 * `progress.ts` counts it, and a make-up with the sequence number of the original it makes up,
 * followed through a chain of make-ups (Q-B1-4 (a)); bounded by the enrollment's sessions.
 */
export function releaseSessionsOf(
  rows: readonly EnrollmentSessionRow[],
  makeups: ReadonlyMap<string, string>,
): ReleaseSession[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const originOf = (row: EnrollmentSessionRow): EnrollmentSessionRow | undefined => {
    let found: EnrollmentSessionRow | undefined;
    let next = makeups.get(row.id);
    for (let step = 0; next !== undefined && step < rows.length; step += 1) {
      found = byId.get(next);
      next = found === undefined ? undefined : makeups.get(found.id);
    }
    return found;
  };
  return rows.map((row) => {
    const origin = originOf(row);
    return {
      sequenceNumber: row.sequenceNumber,
      endsAt: row.endsAt,
      outcome: row.status === 'disputed' ? row.outcomeUnderDispute : row.status,
      ...(origin === undefined ? {} : { madeUpSequence: origin.sequenceNumber }),
    };
  });
}

/** One enrollment's facts, its written releases and its cases, for the sweep and the reads. */
export interface EnrollmentReleases {
  readonly facts: ReleaseFacts;
  readonly written: readonly ReleaseRow[];
  readonly cases: readonly EnrollmentCase[];
}

/**
 * Of `enrollmentIds`, those with a share and a known enrollment, with what their releases are
 * computed from: one read of each owner for them all, the independent ones at once.
 */
export async function releasesAmong(
  tx: Transaction,
  enrollmentIds: readonly string[],
  reads: ReleaseReads = releaseReads,
): Promise<readonly EnrollmentReleases[]> {
  const ids = [...new Set(enrollmentIds)];
  if (ids.length === 0) return [];
  const [orders, written, enrollments, sessions, cases, open, makeups] = await Promise.all([
    reads.shareOrdersOf(tx, ids),
    reads.releasesOf(tx, ids),
    reads.enrollmentsAmong(tx, ids),
    reads.sessionsAmong(tx, ids),
    reads.casesAmong(tx, ids),
    reads.openMattersAmong(tx, ids),
    reads.makeupsAmong(tx, ids),
  ]);
  return ids.flatMap((enrollmentId) => {
    const paid = orders.get(enrollmentId) ?? [];
    const [order] = paid;
    const enrollment = enrollments.get(enrollmentId);
    if (order === undefined || enrollment === undefined) return [];
    const own = written.filter((row) => row.enrollmentId === enrollmentId);
    const enrollmentCases = cases.get(enrollmentId) ?? [];
    return [
      {
        facts: {
          enrollment,
          order,
          orders: paid,
          sessions: releaseSessionsOf(sessions.get(enrollmentId) ?? [], makeups),
          caseReasons: enrollmentCases.map(({ reason }) => reason),
          caseOpen: open.has(enrollmentId),
          written: own.map(({ milestone, amount_piasters }) => ({ milestone, amount_piasters })),
        },
        written: own,
        cases: enrollmentCases,
      },
    ];
  });
}

/** The dispute window (SRS §3.14, 72 hours by default), read with sessions' own rule. */
export function windowHoursOf(settings: SettingsReader): Promise<number> {
  return settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
}

/** What a run wrote and what failed, by release and by enrollment id. */
export interface ShareReleaseRun {
  readonly written: readonly string[];
  readonly failed: readonly string[];
}

export interface ShareReleaseSweep {
  run(): Promise<ShareReleaseRun>;
}

export interface ShareReleaseSweepDependencies {
  readonly transactions: Transactions;
  readonly settings: SettingsReader;
  /**
   * 006:T011 FU-E3: `warn` for a programme's enrollment read with no programme row, where the
   * logger has one (the worker's has; the job's type names `info` and `error` only).
   */
  readonly log: Pick<Logger, 'info' | 'error'> & Partial<Pick<Logger, 'warn'>>;
  /** How many orders each page reads (the job's). */
  readonly pageSize: number;
  readonly report?: (error: Error) => void;
  /** The database's clock on the transaction. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly reads?: ReleaseReads;
  /** Payments' insert, `ON CONFLICT DO NOTHING`; a spec may narrow it. */
  readonly insert?: (
    tx: Transaction,
    releases: readonly DueRelease[],
  ) => Promise<readonly ReleaseRow[]>;
  /** Payments' page of candidate orders; a spec may narrow it. */
  readonly ordersAfter?: (
    tx: Transaction,
    after: string | undefined,
    take: number,
  ) => Promise<readonly ShareOrderRow[]>;
}

function dueOf(one: EnrollmentReleases, planned: readonly PlannedRelease[]): DueRelease[] {
  return planned.flatMap(({ milestone, amount_piasters, dueAt, due }) =>
    due && dueAt !== undefined
      ? [
          {
            enrollmentId: one.facts.enrollment.enrollmentId,
            teacherUserId: one.facts.enrollment.teacherUserId,
            milestone,
            amount_piasters,
            dueAt,
          },
        ]
      : [],
  );
}

export function createShareReleaseSweep({
  transactions,
  settings,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  reads = releaseReads,
  insert = insertDueReleases,
  ordersAfter = shareOrdersAfter,
}: ShareReleaseSweepDependencies): ShareReleaseSweep {
  return {
    run: async () => {
      const windowHours = await windowHoursOf(settings);
      const written: string[] = [];
      const failed: string[] = [];
      // FU-E3: each programme enrollment with no programme row warned once a run, bounded by it.
      const warned = new Set<string>();
      let after: string | undefined;
      for (;;) {
        const { page, due, rowless } = await transactions.run(async (tx) => {
          const orders = await ordersAfter(tx, after, pageSize);
          const [now, among] = await Promise.all([
            clock(tx),
            releasesAmong(
              tx,
              orders.map(({ enrollmentId }) => enrollmentId),
              reads,
            ),
          ]);
          return {
            page: orders,
            due: among
              .map((one) => dueOf(one, plannedReleases(one.facts, { windowHours, now })))
              .filter((releases) => releases.length > 0),
            rowless: among
              .filter(({ facts }) => programmeRowMissing(facts))
              .map(({ facts }) => facts.enrollment.enrollmentId),
          };
        });
        for (const enrollmentId of rowless) {
          if (warned.has(enrollmentId)) continue;
          warned.add(enrollmentId);
          log.warn?.(
            { enrollmentId, reason: 'programme_row_missing' },
            'A programme enrollment has no programme row: no half is owed',
          );
        }
        for (const releases of due) {
          const [first] = releases;
          if (first === undefined) continue;
          try {
            const rows = await transactions.run((tx) => insert(tx, releases));
            for (const row of rows) {
              written.push(row.id);
              log.info(
                {
                  releaseId: row.id,
                  enrollmentId: row.enrollmentId,
                  teacherUserId: row.teacherUserId,
                  milestone: row.milestone,
                },
                "A release of the teacher's share fell due",
              );
            }
          } catch (error: unknown) {
            failed.push(first.enrollmentId);
            log.error(
              { enrollmentId: first.enrollmentId },
              "A release of the teacher's share failed",
            );
            report(error instanceof Error ? error : new Error(String(error)));
          }
        }
        if (page.length < pageSize) break;
        after = page.at(-1)?.paymentId;
      }
      return { written, failed };
    },
  };
}
