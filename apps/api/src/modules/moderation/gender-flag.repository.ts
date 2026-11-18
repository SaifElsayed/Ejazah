// T013 of specs/005-certification (FR-614, FR-615; SRS FR-GENDER-3, FR-GENDER-4; research R-409;
// data-model.md:66; ERD §15 rule 57): the `gender_flags` rows, each on the caller's transaction.
// Queries only; the rules (who may flag whom, who decides) are `gender-flag.service.ts`'s and the
// admin module's, and the one-open rule is the database's (`gender_flags_one_open_per_user_key`).
//
// No lock here. A flag's insert references the flagged user, the raiser and the report, which the
// service key-shares first (kernel.md, «a gender flag raised»). A resolution is one conditional
// update `WHERE status = 'open'` writing the outcome, the reason, the instant and the administrator
// together, so two resolutions at once write once: the second waits on the first's row lock, then
// reads the row again and matches nothing. The reads take none. Over the primary key and the
// `(flagged_user_id)` index; the page is bounded by `take`. A flag's reason is never logged here.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';

type Client = Pick<Transaction, 'genderFlag'>;

/** A flag's state (`gender_flag_status`, ERD §10). */
export type GenderFlagStatus = 'open' | 'corrected' | 'fraud_ban' | 'dismissed';
/** How an open flag is closed (FR-615). */
export type GenderFlagOutcome = Exclude<GenderFlagStatus, 'open'>;

/** A flag as it is inserted: by a user (`raisedByUserId`) or an administrator (null), from a report or not. */
export interface NewGenderFlag {
  readonly flaggedUserId: string;
  readonly raisedByUserId: string | null;
  readonly reportId: string | null;
  readonly reason: string;
}

/** A flag as the administrator reads it (ERD §10). */
export interface GenderFlagRow {
  readonly id: string;
  readonly flaggedUserId: string;
  readonly raisedByUserId: string | null;
  readonly reportId: string | null;
  readonly status: GenderFlagStatus;
  readonly reason: string;
  readonly createdAt: Date;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedByAdminId: string | null;
}

/** One page of the queue: a status, after a flag id, at most `take`. */
export interface GenderFlagPageQuery {
  readonly status: GenderFlagStatus;
  readonly after?: string | undefined;
  readonly take: number;
}

/** An administrator's closing of an open flag (FR-615). */
export interface GenderFlagResolution {
  readonly flagId: string;
  readonly outcome: GenderFlagOutcome;
  readonly note: string;
  readonly adminId: string;
  readonly at: Date;
}

/**
 * Inserts an open flag; its id, or null when the database refuses it because the person already has
 * one open. Any other refusal is thrown as it is. A null leaves the transaction aborted: the caller
 * refuses and rolls it back.
 */
export async function insertGenderFlag(tx: Client, row: NewGenderFlag): Promise<string | null> {
  try {
    const { id } = await tx.genderFlag.create({
      data: { ...row, status: 'open' },
      select: { id: true },
    });
    return id;
  } catch (error: unknown) {
    if (isUniqueViolation(error, 'gender_flags_one_open_per_user_key')) return null;
    throw error;
  }
}

/** One flag by its id, or null; no lock. */
export function genderFlagOf(tx: Client, flagId: string): Promise<GenderFlagRow | null> {
  return tx.genderFlag.findUnique({
    where: { id: flagId },
    select: {
      id: true,
      flaggedUserId: true,
      raisedByUserId: true,
      reportId: true,
      status: true,
      reason: true,
      createdAt: true,
      resolutionNotes: true,
      resolvedAt: true,
      resolvedByAdminId: true,
    },
  });
}

/** The queue's page: the open flags oldest first, the closed ones newest first, after `after`. */
export function genderFlagsPage(tx: Client, query: GenderFlagPageQuery): Promise<GenderFlagRow[]> {
  const open = query.status === 'open';
  return tx.genderFlag.findMany({
    where: {
      status: query.status,
      ...(query.after === undefined
        ? {}
        : { id: open ? { gt: query.after } : { lt: query.after } }),
    },
    orderBy: { id: open ? 'asc' : 'desc' },
    take: query.take,
    select: {
      id: true,
      flaggedUserId: true,
      raisedByUserId: true,
      reportId: true,
      status: true,
      reason: true,
      createdAt: true,
      resolutionNotes: true,
      resolvedAt: true,
      resolvedByAdminId: true,
    },
  });
}

/**
 * Closes the flag if it is still open, writing the outcome, the reason, the instant and the
 * administrator together; answers whether it did. A flag no longer open, or none, is left as it is.
 */
export async function resolveGenderFlag(
  tx: Client,
  { flagId, outcome, note, adminId, at }: GenderFlagResolution,
): Promise<boolean> {
  const { count } = await tx.genderFlag.updateMany({
    where: { id: flagId, status: 'open' },
    data: { status: outcome, resolutionNotes: note, resolvedAt: at, resolvedByAdminId: adminId },
  });
  return count === 1;
}
