// 003:T110 (ADR 0025 D4, SRS DEC-85, DEC-86, FR-DISPUTE-6; the note under T110): what a compensation
// case that closes an enrollment shows, `payments.caseAmount`. The rules are `case-amount.rules.ts`'s,
// the amounts `packages/money`'s; nothing here moves money (DEC-82).
//
// THE OWNERS (R-API-6): the case's kind, enrollment and reason are moderation's (`caseRecordOf`); the
// enrollment's track and count booking's; its sessions' outcomes sessions' (a disputed one by its
// frozen outcome, a make-up by its original, `releaseSessionsOf`); the orders and the releases
// payments' own. A case whose reason gives no amount reads nothing more; the rest are read at once.
// Each read is bounded by one enrollment and takes no lock: the amount is a figure.
import type { PaymentsCaseAmountOutput } from '@ijazah/contracts/admin';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { type CaseRecord, caseRecordOf } from '../moderation/index.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import { caseOrdersOf } from './case-amount.repository.js';
import { caseAmountOf, type CaseOrder } from './case-amount.rules.js';
import { type ReleaseRow, releasesOf } from './share-release.repository.js';
import { closingCauseOf, type ReleaseEnrollment } from './share-release.rules.js';
import { releaseReads, releaseSessionsOf } from './share-release.service.js';

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
}

/** The reads over payments' own queries and the owners' entries, the releases' own where shared. */
export const caseAmountReads: CaseAmountReads = {
  caseRecordOf,
  caseOrdersOf,
  releasesOf,
  enrollmentsAmong: releaseReads.enrollmentsAmong,
  sessionsAmong: releaseReads.sessionsAmong,
  makeupsAmong: releaseReads.makeupsAmong,
};

/** The amount case `caseId` shows, none for a reason outside the map; NOT_FOUND for no case. */
export async function caseAmount(
  tx: Transaction,
  caseId: string,
  reads: CaseAmountReads = caseAmountReads,
): Promise<PaymentsCaseAmountOutput> {
  const found = await reads.caseRecordOf(tx, caseId);
  if (found === null) throw new DomainError('NOT_FOUND');
  if (found.kind !== 'compensation_case' || closingCauseOf(found.reason) === undefined) return {};
  const ids = [found.enrollmentId];
  const [orders, releases, enrollments, sessions, makeups] = await Promise.all([
    reads.caseOrdersOf(tx, found.enrollmentId),
    reads.releasesOf(tx, ids),
    reads.enrollmentsAmong(tx, ids),
    reads.sessionsAmong(tx, ids),
    reads.makeupsAmong(tx, ids),
  ]);
  const enrollment = enrollments.get(found.enrollmentId);
  if (enrollment === undefined) return {};
  const amount = caseAmountOf({
    kind: found.kind,
    reason: found.reason,
    track: enrollment.track,
    sessionCount: enrollment.sessionCount,
    orders,
    sessions: releaseSessionsOf(sessions.get(found.enrollmentId) ?? [], makeups),
    releases: releases.map(({ milestone, amount_piasters, markedAt }) => ({
      milestone,
      amount_piasters,
      marked: markedAt !== null,
    })),
  });
  return amount === undefined ? {} : { amount };
}
