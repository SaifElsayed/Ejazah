// 003:T110 (ADR 0025 D4, SRS DEC-85, DEC-86, FR-DISPUTE-6; the note under T110): what a compensation
// case that closes an enrollment shows, `payments.caseAmount`. The rules are `case-amount.rules.ts`'s,
// the amounts `packages/money`'s; nothing here moves money (DEC-82).
//
// THE OWNERS (R-API-6): the case's kind, enrollment and reason are moderation's (`caseRecordOf`); the
// enrollment's track and count booking's; its sessions' outcomes sessions' (a disputed one by its
// frozen outcome, a make-up by its original, `releaseSessionsOf`; 006:T012: an offer session's
// programme month); the orders (006:T012: with their kinds and months) and the releases payments'
// own. A case whose reason gives no amount reads nothing more; the rest are read at once. Each read
// is bounded by one enrollment and takes no lock: the amount is a figure.
//
// 006:T012 (FR-729; the B-P2 conflict check): an `admin_ended` case is read on, as it gives an amount
// on a programme where it covered the open `teacher_suspended` case (`closePausedCaseOnEnd`). That
// suspension case is closed `ended_meanwhile` by the end (a reinstatement's note is `reinstated`), and
// an enrollment ends once, so the end that closed it is this case: moderation's cases of the
// enrollment, then each `teacher_suspended` one's record (bounded by the enrollment's cases).
import type { PaymentsCaseAmountOutput } from '@ijazah/contracts/admin';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type CaseRecord,
  caseRecordOf,
  compensationCasesAmong,
  type EnrollmentCase,
} from '../moderation/index.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import { caseOrdersOf } from './case-amount.repository.js';
import { caseAmountOf, type CaseOrder } from './case-amount.rules.js';
import { type ReleaseRow, releasesOf } from './share-release.repository.js';
import {
  closingCauseOf,
  type ReleaseEnrollment,
  type ReleaseSession,
  SUSPENSION_COVERING_END,
} from './share-release.rules.js';
import {
  releaseReads,
  releaseSessionsOf,
  suspensionsCoveredAmong,
} from './share-release.service.js';

/** What the amount is computed from, each read on the caller's transaction; faked in a spec. */
export interface CaseAmountReads {
  /** Moderation's: the case of that id, any kind, or null. */
  caseRecordOf(tx: Transaction, caseId: string): Promise<CaseRecord | null>;
  caseOrdersOf(tx: Transaction, enrollmentId: string): Promise<readonly CaseOrder[]>;
  releasesOf(tx: Transaction, enrollmentIds: readonly string[]): Promise<readonly ReleaseRow[]>;
  /** Booking's: the enrollment's track and count; an unknown one absent. */
  enrollmentsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReleaseEnrollment>>;
  /** Sessions': the enrollment's sessions by sequence number. */
  sessionsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentSessionRow[]>>;
  /** Sessions': each make-up's id to the id of the session it makes up (Q-B1-4 (a)). */
  makeupsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  /** 006:T012: moderation's, each enrollment's compensation cases, newest first. */
  casesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentCase[]>>;
}

/** The reads over payments' own queries and the owners' entries, the releases' own where shared. */
export const caseAmountReads: CaseAmountReads = {
  caseRecordOf,
  caseOrdersOf,
  releasesOf,
  enrollmentsAmong: releaseReads.enrollmentsAmong,
  sessionsAmong: releaseReads.sessionsAmong,
  makeupsAmong: releaseReads.makeupsAmong,
  casesAmong: compensationCasesAmong,
};

/** 006:T012: the enrollment's sessions as the rules read them, each offer session with its month. */
function sessionsWithMonths(
  rows: readonly EnrollmentSessionRow[],
  makeups: ReadonlyMap<string, string>,
): ReleaseSession[] {
  const monthOf = new Map(
    rows.map(({ sequenceNumber, programmeMonth }) => [sequenceNumber, programmeMonth]),
  );
  return releaseSessionsOf(rows, makeups).map((one) => {
    const programmeMonth = monthOf.get(one.sequenceNumber);
    return programmeMonth === undefined ? one : { ...one, programmeMonth };
  });
}

/**
 * 006:T012: whether the end closed the enrollment's `teacher_suspended` case (this file's head), by
 * the releases' own read (003:T125), so the case and the release never disagree.
 */
async function coveredSuspension(
  tx: Transaction,
  enrollmentId: string,
  reads: CaseAmountReads,
): Promise<boolean> {
  const cases = await reads.casesAmong(tx, [enrollmentId]);
  return (await suspensionsCoveredAmong(tx, cases, reads.caseRecordOf)).has(enrollmentId);
}

/** The amount case `caseId` shows, none for a reason outside the map; NOT_FOUND for no case. */
export async function caseAmount(
  tx: Transaction,
  caseId: string,
  reads: CaseAmountReads = caseAmountReads,
): Promise<PaymentsCaseAmountOutput> {
  const found = await reads.caseRecordOf(tx, caseId);
  if (found === null) throw new DomainError('NOT_FOUND');
  const coveringEnd = found.reason === SUSPENSION_COVERING_END;
  if (found.kind !== 'compensation_case') return {};
  // 003:T125: `admin_ended`, `account_deleted` and `gender_correction` are in the map (`direct_end`).
  if (closingCauseOf(found.reason) === undefined) return {};
  const ids = [found.enrollmentId];
  const [orders, releases, enrollments, sessions, makeups, covers] = await Promise.all([
    reads.caseOrdersOf(tx, found.enrollmentId),
    reads.releasesOf(tx, ids),
    reads.enrollmentsAmong(tx, ids),
    reads.sessionsAmong(tx, ids),
    reads.makeupsAmong(tx, ids),
    coveringEnd ? coveredSuspension(tx, found.enrollmentId, reads) : Promise.resolve(false),
  ]);
  const enrollment = enrollments.get(found.enrollmentId);
  if (enrollment === undefined) return {};
  const amount = caseAmountOf({
    kind: found.kind,
    reason: found.reason,
    track: enrollment.track,
    sessionCount: enrollment.sessionCount,
    orders,
    sessions: sessionsWithMonths(sessions.get(found.enrollmentId) ?? [], makeups),
    coversSuspension: covers,
    releases: releases.map(({ milestone, amount_piasters, markedAt }) => ({
      milestone,
      amount_piasters,
      marked: markedAt !== null,
    })),
  });
  return amount === undefined ? {} : { amount };
}
