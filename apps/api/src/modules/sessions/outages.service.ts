// T016 of specs/004-sessions/tasks.md (FR-445, FR-462, FR-480, FR-495; R-TIME-6; research R-307;
// contracts/admin-surface.md, "`sessions`"; contracts/kernel.md, "outage record"): a provider outage
// window an administrator records, and the list of the windows recorded.
//
// THE WINDOW. Entered as a local date and time for each end and one IANA zone, resolved to instants
// here by `packages/time` (R-TIME-6): an end inside a clock change's gap moves past it, one inside
// an overlap takes the earlier instant (R-TIME-7). A zone the package refuses, or an end not after
// the start, is refused `VALIDATION_FAILED` with nothing written. A window is never edited (rule
// 44); a wrong one is answered by resolving its sessions.
//
// THE RECLASSIFICATION (FR-445; data-model.md §3). In the record's transaction, each session the
// window overlaps (`[start, end)` against the session's scheduled `[start, end)`) that is settled
// (`done`, `*_no_show`, `under_threshold`), still inside its dispute window (its scheduled end less
// than `dispute_window_hours` ago by the database's clock, `clockTimestamp`, which completion reads
// too: the owner's decision of 2026-11-08 on lane D's questions, Q3) and not disputed moves to `provider_outage`, the review queue's,
// with one `session_events` row `outage_reclassified` each; a session an administrator resolved or
// revised inside its window is settled so, and is included. No remedy exists before a session's
// dispute window closes (FR-462; the third analysis, G1), so none is withdrawn. Then T015's
// completion check for each enrollment touched (`completion.service.ts`); no count is read (FR-448).
//
// THE LOCKS (kernel.md's "outage record" row, the owner's decision of 2026-11-05 on the analysis,
// F4). The overlapped sessions are found with no lock, and with them the `scheduled` sessions the
// window overlaps that have ended by the record's instant, those `evaluate-sessions` may be settling
// now (PR #129's review, Minor 1; the owner's decision of 2026-11-08); then all their enrollments,
// in one call in id order (`EnrollmentSide.lockEnrollments`), then all those sessions, in one call
// in id order, T005's one order and the sweep's; each is read again under the locks before its
// conditional update, so one disputed or settled otherwise meanwhile is left out, and one a sweep
// settled while the record waited is reclassified. A sweep that comes second waits on the
// enrollment and then reads the committed window (`tests/db-integrity/outage-evaluation-race.spec.ts`).
// "Ended" and not "due": the record's instant less the evaluation delay would leave a session the
// sweep's later clock finds due, at the boundary, outside the locks. The window's row references
// only the administrator, no row of the order. Every `session_events` row references an
// enrollment already held.
//
// THE RECORDER'S NAME. `admin_users` is the admin module's table (R-API-6), and the admin module
// imports sessions, so the list takes the names through `AdminNames`, a function the admin module
// hands in (`modules/admin/index.ts`): the eighth dependency handed in against the arrows
// (docs/ARCHITECTURE.md; the owner's decision of 2026-11-08 on lane D's questions, Q6).
//
// THE LOG (the owner's rule). A refusal writes one info line with the administrator's id and the
// reason code; a record writes one with the window's id and the sessions it reclassified.
import { addHours, resolveLocalDateTime, TimeError } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { Completion } from './completion.service.js';
import { DISPUTE_WINDOW_SETTING, disputeWindowHours } from './completion.service.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import {
  endedScheduledSessions,
  insertOutage,
  type OutageRow,
  outagesPage,
  type OutageWindow,
  type OverlappedSession,
  reclassifiableSessions,
  reclassify,
} from './outages.repository.js';
import { lockRows } from './remaining-sessions.repository.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** One end of the window as the administrator entered it: `HH:MM` in the input's zone. */
export interface OutageWallClock {
  readonly localDate: string;
  readonly localTime: string;
}

export interface OutageRecordInput {
  readonly start: OutageWallClock;
  readonly end: OutageWallClock;
  readonly timezone: string;
  readonly reason: string;
}

export interface OutageRecorded {
  readonly outageId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reclassified: number;
}

/** One window as the list answers it (admin-surface.md, `sessions.outages.list`). */
export interface OutageListed {
  readonly outageId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
  readonly recordedBy: { readonly adminId: string; readonly displayName: string };
}

export interface OutagePage {
  readonly items: OutageListed[];
  readonly nextCursor?: string;
}

/**
 * The administrators' display names by id, the admin module's (`admin_users` is its table, R-API-6),
 * bound by the composition root; an id it does not answer is named by an empty string.
 */
export type AdminNames = (
  tx: Transaction,
  adminIds: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/** What the record and the list read and write, each on the caller's transaction. */
export interface OutageStore {
  reclassifiableSessions(
    tx: Transaction,
    window: OutageWindow,
    endedAfter: Date,
    ids?: readonly string[],
  ): Promise<readonly OverlappedSession[]>;
  /** The scheduled sessions `window` overlaps that ended at or before `endedBy`; no lock. */
  endedScheduledSessions(
    tx: Transaction,
    window: OutageWindow,
    endedBy: Date,
  ): Promise<readonly OverlappedSession[]>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  reclassify(tx: Transaction, ids: readonly string[]): Promise<void>;
  insertOutage(
    tx: Transaction,
    outage: OutageWindow & { readonly reason: string; readonly recordedByAdminId: string },
  ): Promise<string>;
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
  outagesPage(tx: Transaction, cursor: string | undefined, take: number): Promise<OutageRow[]>;
}

/** The record's and the list's store over sessions' tables. */
export const outageStore: OutageStore = {
  reclassifiableSessions,
  endedScheduledSessions,
  lockSessions: (tx, ids) => lockRows(tx, 'sessions', ids),
  reclassify,
  insertOutage,
  recordEvents: recordSessionEvents,
  outagesPage,
};

export interface OutageServices {
  record(tx: Transaction, adminId: string, input: OutageRecordInput): Promise<OutageRecorded>;
  list(tx: Transaction, input: { readonly cursor?: string }): Promise<OutagePage>;
}

/** `ids` once each, in id order. */
const sortedUnique = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

export function createOutageServices({
  enrollments,
  completion,
  settings,
  log,
  adminNames,
  clock = clockTimestamp,
  store = outageStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'lockEnrollments'>;
  readonly completion: Completion;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  readonly adminNames: AdminNames;
  /** The database's clock on the call's transaction, as completion reads it (Q3). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: OutageStore;
}): OutageServices {
  /** The administrator's window as instants, or the refusal, logged. */
  const windowOf = (adminId: string, input: OutageRecordInput): OutageWindow => {
    const instant = ({ localDate, localTime }: OutageWallClock): Date =>
      new Date(
        resolveLocalDateTime({ localDate, localTime: `${localTime}:00`, timezone: input.timezone })
          .startsAt,
      );
    let window: OutageWindow;
    try {
      window = { startsAt: instant(input.start), endsAt: instant(input.end) };
    } catch (error: unknown) {
      if (!(error instanceof TimeError)) throw error;
      log.info({ adminId, reason: 'unknown_zone' }, 'Outage window refused');
      throw new DomainError('VALIDATION_FAILED', undefined, {
        details: [{ path: 'timezone', code: 'unknown' }],
      });
    }
    if (window.endsAt.getTime() <= window.startsAt.getTime()) {
      log.info({ adminId, reason: 'end_not_after_start' }, 'Outage window refused');
      throw new DomainError('VALIDATION_FAILED', undefined, {
        details: [{ path: 'end', code: 'not_after_start' }],
      });
    }
    return window;
  };

  return {
    record: async (tx, adminId, input) => {
      const window = windowOf(adminId, input);
      const at = await clock(tx);
      const hours = await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
      const endedAfter = new Date(addHours(at, -hours));
      const held = [
        ...(await store.reclassifiableSessions(tx, window, endedAfter)),
        ...(await store.endedScheduledSessions(tx, window, at)),
      ];
      let moved: readonly OverlappedSession[] = [];
      if (held.length > 0) {
        await enrollments.lockEnrollments(
          tx,
          sortedUnique(held.map(({ enrollmentId }) => enrollmentId)),
        );
        const ids = sortedUnique(held.map(({ id }) => id));
        await store.lockSessions(tx, ids);
        moved = await store.reclassifiableSessions(tx, window, endedAfter, ids);
      }
      const outageId = await store.insertOutage(tx, {
        ...window,
        reason: input.reason,
        recordedByAdminId: adminId,
      });
      if (moved.length > 0) {
        await store.reclassify(
          tx,
          moved.map(({ id }) => id),
        );
        await store.recordEvents(
          tx,
          moved.map(({ id, enrollmentId }) => ({
            enrollmentId,
            sessionId: id,
            kind: 'outage_reclassified',
            occurredAt: at,
          })),
        );
        for (const enrollmentId of sortedUnique(moved.map(({ enrollmentId: id }) => id))) {
          await completion.completeIfDue(tx, enrollmentId);
        }
      }
      log.info(
        { outageId, sessionIds: moved.map(({ id }) => id) },
        'Outage window recorded and its sessions reclassified',
      );
      return {
        outageId,
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        reclassified: moved.length,
      };
    },
    list: async (tx, { cursor }) => {
      const size = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const rows = await store.outagesPage(tx, cursor, size + 1);
      const page = rows.slice(0, size);
      const names = await adminNames(tx, sortedUnique(page.map(({ recordedByAdminId }) => recordedByAdminId)));
      const items = page.map(({ outageId, startsAt, endsAt, reason, recordedByAdminId }) => ({
        outageId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason,
        recordedBy: { adminId: recordedByAdminId, displayName: names.get(recordedByAdminId) ?? '' },
      }));
      const last = page.at(-1);
      return rows.length > size && last !== undefined
        ? { items, nextCursor: last.outageId }
        : { items };
    },
  };
}
