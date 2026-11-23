// 006:T008 of specs/006-programme (FR-706a, FR-706b, FR-709; R-505, R-513; I-2 (a), N-10; SRS
// DEC-101; contracts/app-surface.md `programme.request`, admin-surface.md `programmes.decide`; B-P2's
// conflict check, Q-2 (a), Q-7 (a)): the teacher's refusal request and an administrator's decision on
// an item. The file name is T017's (`programme-requests.*`), which adds the stop request to both.
//
// THE REFUSAL REQUEST (`programme.request` `refusal`, FR-709). A teacher never refuses a student on
// their own after the assessment: they give an administrator a reason (1–500 characters). The
// programme read once with no lock for its teacher, anyone else NOT_FOUND as an unknown id; then the
// teacher's `users` row (`lockAccount`: the item's insert key-shares it through its foreign key, and
// every price writer and `programme.offer` take it first, kernel.md, 006:T008's row), the programme's
// row, the enrollment's, read again under them. Refused `CONFLICT` with the cause, nothing written,
// one line: `offer_sent` past `awaiting_offer` (an offer sent, or the programme closed), and so once
// the enrollment is no longer `confirmed`; `assessment_not_delivered` while session 1's outcome chain
// is not delivered; `request_open` while a refusal is open (rule 79's partial unique, read under the
// lock). Otherwise one open `refusal` item with the reason; `enrollment` to both parties after the
// commit. `stop` is T017's: refused `not_paused` while the programme is not `paused`, and no path
// pauses one before T015 (B-P3), where T017 adds the rest.
//
// THE DECISION (`programmes.decide`). Keyed on the administrator kind's transaction (`runOn`), the
// item read with no lock (an unknown id NOT_FOUND), then the programme's row (the sweep's step's
// lock), the enrollment's, and the item read again under them: one no longer open `CONFLICT`
// `not_open`. By kind (a decision the kind does not take `CONFLICT` `decision_not_allowed`):
// - `refusal`: approve → the programme's own end, `assessment_refused` (only while `awaiting_offer`,
//   else `offer_sent`); decline → `declined`.
// - `no_offer` (I-2 (a)): approve → the same refusal; extend → `extended`, the offer's deadline
//   derived again with the decision's instant as the latest extension (`programme_offer_hours` more,
//   counted from the decision) and written; the sweep opens a new item at the new deadline. No
//   decline (N-10).
// - `pay_blocked` (FR-706b): approve → the lapse, `offer_lapsed` (only while `offered`, else
//   `not_offered`); extend → `pay_by_at` = the decision + `programme_pay_rest_hours`, `extended`.
//   No decline.
// The item's administrator and instant are set together (rule 81) by one conditional update `WHERE
// status = 'open'`. The end goes through the close hook, which withdraws any other open item of the
// programme. One info line of ids and the decision; `enrollment` to both parties after the commit,
// on the administrator kind's bound publisher. The router audits it (R-API-12).
import type {
  ProgrammeRequestInput,
  ProgrammeRequestOutput,
  ProgrammeRequestRefusal,
} from '@ijazah/contracts';
import type {
  ProgrammesDecideInput,
  ProgrammesDecideOutput,
  ProgrammesDecision,
} from '@ijazah/contracts/admin';
import { addHours } from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { type LivePublisher, publisherOn } from '../../platform/live/live-publisher.js';
import { positiveWhole } from '../../platform/settings/registry.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { lockAccount } from '../identity/index.js';
import { type AssessmentOutcome, assessmentOutcome } from '../sessions/index.js';
import {
  type DeleteProgrammeCard,
  endProgramme,
  type ProgrammeEndReason,
  type ProgrammeEndStore,
} from './programme-close.service.js';
import {
  decideRequest,
  insertRequest,
  openRequestExists,
  type ProgrammeRequestRow,
  requestById,
} from './programme-requests.repository.js';
import {
  type ProgrammeFacts,
  programmeFactsOf,
  writeOfferDue,
  writePayBy,
} from './programmes.repository.js';
import { offerDueOf } from './programmes.rules.js';
import type { ProgrammeLog } from './programmes.service.js';

/** §3.14's two windows, the settings `programmes.service.ts` names too. */
const OFFER_HOURS = 'programme_offer_hours';
const PAY_REST_HOURS = 'programme_pay_rest_hours';

/** What the refusal request reads and writes, over booking's rows and the owners' entries. */
export interface ProgrammeRequestStore {
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
  openRequestExists(tx: Transaction, enrollmentId: string, kind: 'refusal'): Promise<boolean>;
  insertRequest(
    tx: Transaction,
    item: {
      readonly enrollmentId: string;
      readonly teacherUserId: string;
      readonly kind: 'refusal';
      readonly reason: string;
    },
  ): Promise<string>;
}

export const programmeRequestStore: ProgrammeRequestStore = {
  programmeFactsOf,
  lockAccount,
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  assessmentOutcome,
  openRequestExists,
  insertRequest,
};

/** What the refusal request is built over. */
export interface ProgrammeRequestDependencies {
  readonly log: ProgrammeLog;
  readonly store?: ProgrammeRequestStore;
}

/** A refusal of `programme.request` or of `programmes.decide`, its one line logged (FR-733). */
function refusal(
  log: ProgrammeLog,
  ids: Readonly<Record<string, string>>,
  cause: string,
  message: string,
): DomainError {
  log.info({ ...ids, reason: cause }, message);
  return markRefusalLogged(
    new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: cause }] }),
  );
}

/**
 * `programme.request` on the keyed effect's transaction (this file's head, THE REFUSAL REQUEST).
 */
export async function requestProgramme(
  tx: Transaction,
  teacherUserId: string,
  input: Omit<ProgrammeRequestInput, 'idempotencyKey'>,
  live: Pick<LivePublisher, 'afterCommit'>,
  { log, store = programmeRequestStore }: ProgrammeRequestDependencies,
): Promise<ProgrammeRequestOutput> {
  const ids = { teacherUserId, enrollmentId: input.enrollmentId };
  const refused = (cause: ProgrammeRequestRefusal): DomainError =>
    refusal(log, ids, cause, 'A programme request was refused');
  const seen = await store.programmeFactsOf(tx, input.enrollmentId);
  if (seen === null || seen.teacherUserId !== teacherUserId) throw new DomainError('NOT_FOUND');
  await store.lockAccount(tx, teacherUserId);
  await store.lockProgramme(tx, seen.enrollmentId);
  await store.lockEnrollment(tx, seen.enrollmentId);
  const facts = await store.programmeFactsOf(tx, seen.enrollmentId);
  if (facts === null) throw new DomainError('NOT_FOUND');
  if (input.kind === 'stop') {
    if (facts.state !== 'paused') throw refused('not_paused');
    // No path pauses a programme before T015 (B-P3); T017 builds the stop request there.
    throw new Error('programme.request stop on a paused programme is T017');
  }
  if (facts.state !== 'awaiting_offer' || facts.status !== 'confirmed') {
    throw refused('offer_sent');
  }
  if ((await store.assessmentOutcome(tx, facts.enrollmentId)).kind !== 'delivered') {
    throw refused('assessment_not_delivered');
  }
  if (await store.openRequestExists(tx, facts.enrollmentId, 'refusal')) {
    throw refused('request_open');
  }
  const requestId = await store.insertRequest(tx, {
    enrollmentId: facts.enrollmentId,
    teacherUserId,
    kind: 'refusal',
    reason: input.reason,
  });
  log.info({ ...ids, requestId, reason: 'refusal_requested' }, 'A programme request was opened');
  live.afterCommit([facts.studentUserId, facts.teacherUserId], {
    type: 'enrollment',
    enrollmentId: facts.enrollmentId,
  });
  return { requestId };
}

/** What a decision answers: the audit's target and whether the key replayed it. */
export interface ProgrammeDecision {
  readonly answer: ProgrammesDecideOutput;
  readonly replayed: boolean;
  readonly enrollmentId: string;
}

/** `programmes.decide`'s service, on the administrator kind's transaction. */
export interface ProgrammeDecisions {
  decide(
    tx: Transaction,
    adminId: string,
    input: ProgrammesDecideInput,
  ): Promise<ProgrammeDecision>;
}

/** What the decision reads and writes, over booking's rows and the owners' entries. */
export interface ProgrammeDecisionStore {
  requestById(tx: Transaction, requestId: string): Promise<ProgrammeRequestRow | null>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  decideRequest(
    tx: Transaction,
    requestId: string,
    decision: {
      readonly status: 'approved' | 'declined' | 'extended';
      readonly adminId: string;
      readonly at: Date;
    },
  ): Promise<boolean>;
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
  writeOfferDue(tx: Transaction, enrollmentId: string, offerDueAt: Date | null): Promise<void>;
  writePayBy(tx: Transaction, enrollmentId: string, payByAt: Date): Promise<boolean>;
}

export const programmeDecisionStore: ProgrammeDecisionStore = {
  requestById,
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  programmeFactsOf,
  decideRequest,
  assessmentOutcome,
  writeOfferDue,
  writePayBy,
};

/** What the decision is built over; `main.ts` binds payments' card entry and the log. */
export interface ProgrammeDecisionDependencies {
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  readonly settings: SettingsReader;
  readonly deleteProgrammeCard: DeleteProgrammeCard;
  readonly log: ProgrammeLog;
  /** The database's clock on the transaction (`clock_timestamp()`), the decision's instant. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ProgrammeDecisionStore;
  readonly end?: ProgrammeEndStore;
}

/** The decisions each kind takes (this file's head, THE DECISION). */
const ALLOWED: Readonly<Record<ProgrammeRequestRow['kind'], readonly ProgrammesDecision[]>> = {
  refusal: ['approve', 'decline'],
  no_offer: ['approve', 'extend'],
  pay_blocked: ['approve', 'extend'],
  // T017's: approving a stop closes `programme_stopped`; no stop item exists before it.
  stop: [],
};

/** What an approval ends, and the state it ends from. */
function endingOf(kind: ProgrammeRequestRow['kind']): {
  readonly reason: ProgrammeEndReason;
  readonly from: 'offered' | 'awaiting_offer';
} {
  return kind === 'pay_blocked'
    ? { reason: 'offer_lapsed', from: 'offered' }
    : { reason: 'assessment_refused', from: 'awaiting_offer' };
}

const STATUS_OF = { approve: 'approved', decline: 'declined', extend: 'extended' } as const;

/** `programmes.decide` over `dependencies` (this file's head, THE DECISION). */
export function createProgrammeDecisions(
  dependencies: ProgrammeDecisionDependencies,
): ProgrammeDecisions {
  const store = dependencies.store ?? programmeDecisionStore;
  const clock = dependencies.clock ?? clockTimestamp;
  const { log } = dependencies;

  /** The programme's own end, through the close hook. */
  const end = async (
    tx: Transaction,
    enrollmentId: string,
    reason: ProgrammeEndReason,
  ): Promise<void> => {
    const ended = await endProgramme(tx, enrollmentId, reason, {
      deleteProgrammeCard: dependencies.deleteProgrammeCard,
      log,
      clock,
      ...(dependencies.end === undefined ? {} : { end: dependencies.end }),
    });
    // The state was read under the locks held, so the enrollment is still `confirmed`.
    if (!ended) throw new Error('programmes.decide: a confirmed enrollment did not move');
  };

  /** An extension's write: the offer's deadline derived again, or `pay_by_at` moved. */
  const extend = async (
    tx: Transaction,
    kind: ProgrammeRequestRow['kind'],
    enrollmentId: string,
    at: Date,
  ): Promise<boolean> => {
    if (kind === 'no_offer') {
      const offerHours = await dependencies.settings.read(OFFER_HOURS, positiveWhole);
      const outcome = await store.assessmentOutcome(tx, enrollmentId);
      await store.writeOfferDue(
        tx,
        enrollmentId,
        offerDueOf({ outcome, extendedAt: at, offerHours }),
      );
      return true;
    }
    const payRestHours = await dependencies.settings.read(PAY_REST_HOURS, positiveWhole);
    return store.writePayBy(tx, enrollmentId, new Date(addHours(at, payRestHours)));
  };

  const decideLocked = async (
    tx: Transaction,
    adminId: string,
    item: ProgrammeRequestRow,
    decision: ProgrammesDecision,
  ): Promise<ProgrammesDecideOutput> => {
    const ids = { adminId, requestId: item.id, enrollmentId: item.enrollmentId };
    const refused = (cause: string) => refusal(log, ids, cause, 'A programme decision was refused');
    await store.lockProgramme(tx, item.enrollmentId);
    await store.lockEnrollment(tx, item.enrollmentId);
    const current = await store.requestById(tx, item.id);
    const facts = await store.programmeFactsOf(tx, item.enrollmentId);
    if (current?.status !== 'open' || facts === null) throw refused('not_open');
    if (!ALLOWED[current.kind].includes(decision)) throw refused('decision_not_allowed');
    const ending = decision === 'approve' ? endingOf(current.kind) : null;
    const from = ending?.from ?? (current.kind === 'pay_blocked' ? 'offered' : null);
    if (from !== null && (facts.state !== from || facts.status !== 'confirmed')) {
      throw refused(from === 'offered' ? 'not_offered' : 'offer_sent');
    }
    const at = await clock(tx);
    const status = STATUS_OF[decision];
    if (!(await store.decideRequest(tx, current.id, { status, adminId, at }))) {
      throw refused('not_open');
    }
    if (ending !== null) await end(tx, facts.enrollmentId, ending.reason);
    if (decision === 'extend' && !(await extend(tx, current.kind, facts.enrollmentId, at))) {
      throw refused('not_offered');
    }
    log.info({ ...ids, kind: current.kind, reason: status }, 'A programme item was decided');
    publisherOn(tx)?.afterCommit([facts.studentUserId, facts.teacherUserId], {
      type: 'enrollment',
      enrollmentId: facts.enrollmentId,
    });
    return { status };
  };

  return {
    decide: async (tx, adminId, { idempotencyKey, ...input }) => {
      const item = await store.requestById(tx, input.requestId);
      if (item === null) throw new DomainError('NOT_FOUND');
      const { outcome, replayed } = await dependencies.idempotency.runOn<ProgrammesDecideOutput>(
        tx,
        { scope: 'programmes.decide', key: idempotencyKey, actorId: adminId, input },
        (keyed) => decideLocked(keyed, adminId, item, input.decision),
      );
      return { answer: outcome, replayed, enrollmentId: item.enrollmentId };
    },
  };
}
