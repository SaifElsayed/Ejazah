// 006:T008 of specs/006-programme (FR-706a, FR-706b, FR-709; R-505, R-513; I-2 (a), N-10; SRS
// DEC-101, DEC-112; contracts/app-surface.md `programme.request`, admin-surface.md `programmes.decide`;
// B-P2's conflict check, Q-2 (a), Q-7 (a)): the teacher's request and an administrator's decision on
// an item. The file name is T017's (`programme-requests.*`), which builds the stop request in both.
//
// NO REFUSAL REQUEST (SRS DEC-112, the owner, 2026-11-23). The teacher's app has no refusal request:
// a teacher who will not continue tells support and sends no offer; at `offer_due_at` the `no_offer`
// item opens, and an administrator's approval of it is the refusal (`assessment_refused`, the fee
// kept). `programme.request` takes `stop` alone. The programme read once with no lock for its
// teacher, anyone else NOT_FOUND as an unknown id; then the teacher's `users` row (`lockAccount`: the
// insert key-shares it through its foreign key, and every price writer and `programme.offer` take it
// first, kernel.md, 006:T008's row), the programme's row, the enrollment's, read again under them. A
// `refusal` row the database may still hold (`programme_request_kind` keeps the value, no migration)
// takes no decision.
//
// THE STOP (006:T017; FR-723, FR-BOOK-18, R-513; SRS DEC-112 (3)). Under those locks, refused
// `CONFLICT` with its cause, nothing written, one line of ids and the cause: `not_paused` while the
// programme is not `paused` or its enrollment no longer `confirmed`; `too_early` before `paused_at` +
// `programme_stop_request_days` (§3.14, 7) whole days of 24 hours on the instant (`packages/time`),
// against the database's clock (the app shows the button only from then; this is the server's
// guard); `request_open` while a stop is open (rule 79's partial unique index is the database's
// guarantee; the check under the programme's lock answers it first). Otherwise one open `stop` with
// the teacher's reason (1–500, the contract's bound), its enrollment and teacher the row's, never the
// input's; one info line of ids, never the reason's text; `enrollment` to both parties after the
// commit, added inside the keyed effect, so a replay sends none. The pause's 7 days keep the weekly
// time reserved: the enrollment stays `confirmed`.
//
// THE DECISION (`programmes.decide`). Keyed on the administrator kind's transaction (`runOn`), the
// item read with no lock (an unknown id NOT_FOUND), then the programme's row (the sweep's step's
// lock), the enrollment's, and the item read again under them: one no longer open `CONFLICT`
// `not_open`. By kind (a decision the kind does not take `CONFLICT` `decision_not_allowed`):
// - `no_offer` (I-2 (a)): both decisions need the administrator's `reason` (1–500), the record of
//   what the teacher sent support, written to the item's `reason` in the decision's transaction;
//   without it `reason_required` (SRS DEC-112; the service's rule, no database check). Approve → the
//   refusal, the programme's own end `assessment_refused` (only while `awaiting_offer`, else
//   `offer_sent`; and not while session 1's make-up is pending, `makeup_pending`, Q-B5 (a), the
//   outcome chain «waiting»); extend → `extended`, the offer's deadline derived again with the
//   decision's instant as the latest extension (`programme_offer_hours` more, counted from the
//   decision) and written; the sweep opens a new item at the new deadline. No decline (N-10).
// - `pay_blocked` (FR-706b): approve → the lapse, `offer_lapsed` (only while `offered`, else
//   `not_offered`); extend → `pay_by_at` = the decision + `programme_pay_rest_hours`, `extended`.
//   No decline.
// - `stop` (006:T017; FR-725, R-513): approve → the programme's own end `programme_stopped`, only
//   while `paused` (else `not_open`: a paid month withdraws an open stop on its own transaction, T016,
//   so an open stop on a programme no longer paused is a stale item); decline → `declined`, nothing
//   ends. No extension (rule 80's check refuses an `extended` stop). The weekly time is offered again
//   at once (`programme_stopped` is not among the occupancy's held closings), and the release is
//   payments' own `programme_stopped` branch (T011), reached by the enrollment's reason.
// The item's administrator and instant are set together (rule 81) by one conditional update `WHERE
// status = 'open'`. The end goes through the close hook, which withdraws any other open item of the
// programme. One info line of ids and the decision, never the reason's text; `enrollment` to both
// parties after the commit, on the administrator kind's bound publisher. The router audits it
// (R-API-12).
import type {
  ProgrammeRequestInput,
  ProgrammeRequestOutput,
  ProgrammeRequestRefusal,
} from '@ijazah/contracts';
import type {
  ProgrammesDecideInput,
  ProgrammesDecideOutput,
  ProgrammesDecideRefusal,
  ProgrammesDecision,
  ProgrammesReopenInput,
  ProgrammesReopenOutput,
  ProgrammesReopenRefusal,
} from '@ijazah/contracts/admin';
import { SESSIONS_PER_PROGRAMME_MONTH } from '@ijazah/money';
import {
  addDays,
  addHours,
  type DayOfWeek,
  localDateIn,
  type Occurrence,
  resolveOccurrences,
} from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockKey, lockRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { type LivePublisher, publisherOn } from '../../platform/live/live-publisher.js';
import { positiveWhole } from '../../platform/settings/registry.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { readSlot, type SlotRow } from '../catalog/index.js';
import { lockAccount, type SessionPartyRecord, sessionPartiesOf } from '../identity/index.js';
import {
  type AssessmentOutcome,
  assessmentOutcome,
  enrollmentSessionsOf,
  remedyStatusesAmong,
  type SessionTime,
  windowDaysOf,
} from '../sessions/index.js';
import { recordEnrollmentEvents } from './enrollment-events.repository.js';
import { reopenStoppedEnrollment } from './enrollment-side.repository.js';
import { createEnrollmentSide } from './enrollment-side.service.js';
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
  pausedAtOf,
  type ProgrammeRequestRow,
  reopenProgrammeRow,
  requestById,
  stoppedProgrammeOf,
  type StoppedProgrammeRow,
} from './programme-requests.repository.js';
import {
  type ProgrammeFacts,
  programmeFactsOf,
  writeOfferDue,
  writePayBy,
} from './programmes.repository.js';
import { offerDueOf } from './programmes.rules.js';
import { type ProgrammeLog, withProgrammeTimes } from './programmes.service.js';
import { overlapsAny, partiesBusyBetween, windowOfRuns } from './session-overlap.service.js';
import {
  SLOT_RELEASE_BUFFER_SETTING,
  slotInUse,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';

export type { StoppedProgrammeRow } from './programme-requests.repository.js';

/** §3.14's two windows, the settings `programmes.service.ts` names too. */
const OFFER_HOURS = 'programme_offer_hours';
const PAY_REST_HOURS = 'programme_pay_rest_hours';

/** What the request reads, over booking's rows and the owners' entries. */
export interface ProgrammeRequestStore {
  programmeFactsOf(tx: Transaction, enrollmentId: string): Promise<ProgrammeFacts | null>;
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  /** 006:T017: the programme's pause instant, read under its row lock; null when not paused. */
  pausedAtOf(tx: Transaction, enrollmentId: string): Promise<Date | null>;
  /** 006:T017: whether a `stop` is open on the enrollment (rule 79: at most one). */
  openRequestExists(tx: Transaction, enrollmentId: string, kind: 'stop'): Promise<boolean>;
  /** 006:T017: the open `stop`, its teacher the enrollment's, never the input's; its id. */
  insertRequest(
    tx: Transaction,
    item: {
      readonly enrollmentId: string;
      readonly teacherUserId: string;
      readonly kind: 'stop';
      readonly reason: string;
    },
  ): Promise<string>;
}

export const programmeRequestStore: ProgrammeRequestStore = {
  programmeFactsOf,
  lockAccount,
  lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  pausedAtOf,
  openRequestExists,
  insertRequest,
};

/** What the request is built over. */
export interface ProgrammeRequestDependencies {
  readonly log: ProgrammeLog;
  /** 006:T017: `programme_stop_request_days` (§3.14, 7), read on the request's transaction. */
  readonly settings: SettingsReader;
  /** The database's clock on the transaction (`clock_timestamp()`), the request's instant. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
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

/** §3.14: the pause's days before a teacher may ask to stop (7). */
const STOP_REQUEST_DAYS = 'programme_stop_request_days';

/** `programme.request` on the keyed effect's transaction (this file's head, THE STOP). */
export async function requestProgramme(
  tx: Transaction,
  teacherUserId: string,
  input: Omit<ProgrammeRequestInput, 'idempotencyKey'>,
  live: Pick<LivePublisher, 'afterCommit'>,
  {
    log,
    settings,
    clock = clockTimestamp,
    store = programmeRequestStore,
  }: ProgrammeRequestDependencies,
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
  if (facts.state !== 'paused' || facts.status !== 'confirmed') throw refused('not_paused');
  // Rule 77: a paused programme carries its pause instant.
  const pausedAt = await store.pausedAtOf(tx, facts.enrollmentId);
  if (pausedAt === null) throw refused('not_paused');
  const days = await settings.read(STOP_REQUEST_DAYS, positiveWhole);
  const now = await clock(tx);
  if (now.getTime() < new Date(addDays(pausedAt, days)).getTime()) throw refused('too_early');
  if (await store.openRequestExists(tx, facts.enrollmentId, 'stop')) {
    throw refused('request_open');
  }
  const requestId = await store.insertRequest(tx, {
    enrollmentId: facts.enrollmentId,
    teacherUserId: facts.teacherUserId,
    kind: 'stop',
    reason: input.reason,
  });
  log.info({ ...ids, requestId, reason: 'stop' }, 'A programme stop was requested');
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
  /** 006:T017: `programmes.reopen` (this file's end, THE REOPEN). */
  reopen(tx: Transaction, adminId: string, input: ProgrammesReopenInput): Promise<ProgrammeReopen>;
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
      readonly reason?: string;
    },
  ): Promise<boolean>;
  assessmentOutcome(tx: Transaction, enrollmentId: string): Promise<AssessmentOutcome>;
  writeOfferDue(tx: Transaction, enrollmentId: string, offerDueAt: Date | null): Promise<void>;
  writePayBy(tx: Transaction, enrollmentId: string, payByAt: Date): Promise<boolean>;
  /** 006:T017 (Q-e4 (b)): whether a session of the enrollment is scheduled or a remedy open. */
  sessionsPending(tx: Transaction, enrollmentId: string): Promise<boolean>;
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
  sessionsPending,
};

/**
 * 006:T017 (Q-e4 (b)): whether a session of the enrollment is still `scheduled` (a make-up or a
 * postponed session among them), or one has an open remedy (a remedy's status other than `booked`,
 * whose make-up is the scheduled session, or `refund_case`, handed to its case; sessions' answer
 * leaves `lapsed` out). Sessions' entry, no lock: their writers take the enrollment's lock first,
 * held by the decision. Bounded by the programme's sessions.
 */
async function sessionsPending(tx: Transaction, enrollmentId: string): Promise<boolean> {
  const sessions = await enrollmentSessionsOf(tx, enrollmentId);
  if (sessions.some(({ status }) => status === 'scheduled')) return true;
  const remedies = await remedyStatusesAmong(
    tx,
    sessions.map(({ id }) => id),
  );
  return [...remedies.values()].some((status) => !SETTLED_REMEDIES.has(status));
}

/** A remedy no longer open: its make-up booked, or handed to a case. */
const SETTLED_REMEDIES: ReadonlySet<string> = new Set(['booked', 'refund_case']);

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
  /** 006:T017: the reopen's locks, reads and writes, stood in by a spec. */
  readonly reopenStore?: ProgrammeReopenStore;
}

/** The decisions each kind takes (this file's head, THE DECISION). */
const ALLOWED: Readonly<Record<ProgrammeRequestRow['kind'], readonly ProgrammesDecision[]>> = {
  // SRS DEC-112: no refusal request is written any more; a row the database still holds takes none.
  refusal: [],
  no_offer: ['approve', 'extend'],
  pay_blocked: ['approve', 'extend'],
  // 006:T017 (FR-725, R-513): approving a stop closes `programme_stopped`; no extension.
  stop: ['approve', 'decline'],
  // 006:T014 (SRS DEC-113; lane b's Q-b3 (a)): the sweep's item for an unanswered automatic charge;
  // its approve and extend are built with the sweep (T015) and the panel (T021), none before them.
  charge_unknown: [],
};

/** The state an approval ends from, and its refusal once the programme has left it. */
type EndingFrom = 'offered' | 'awaiting_offer' | 'paused';

const LEFT: Readonly<Record<EndingFrom, ProgrammesDecideRefusal>> = {
  offered: 'not_offered',
  awaiting_offer: 'offer_sent',
  // 006:T017: a stop left open on a programme no longer paused is stale (this file's head).
  paused: 'not_open',
};

/** What an approval ends, and the state it ends from. */
function endingOf(kind: ProgrammeRequestRow['kind']): {
  readonly reason: ProgrammeEndReason;
  readonly from: EndingFrom;
} {
  if (kind === 'stop') return { reason: 'programme_stopped', from: 'paused' };
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
    { decision, reason }: Pick<ProgrammesDecideInput, 'decision' | 'reason'>,
  ): Promise<ProgrammesDecideOutput> => {
    const ids = { adminId, requestId: item.id, enrollmentId: item.enrollmentId };
    const refused = (cause: ProgrammesDecideRefusal) =>
      refusal(log, ids, cause, 'A programme decision was refused');
    await store.lockProgramme(tx, item.enrollmentId);
    await store.lockEnrollment(tx, item.enrollmentId);
    const current = await store.requestById(tx, item.id);
    const facts = await store.programmeFactsOf(tx, item.enrollmentId);
    if (current?.status !== 'open' || facts === null) throw refused('not_open');
    if (!ALLOWED[current.kind].includes(decision)) throw refused('decision_not_allowed');
    // SRS DEC-112: a `no_offer` decision records what the teacher sent support.
    const noOffer = current.kind === 'no_offer';
    if (noOffer && reason === undefined) throw refused('reason_required');
    const ending = decision === 'approve' ? endingOf(current.kind) : null;
    const from = ending?.from ?? (current.kind === 'pay_blocked' ? 'offered' : null);
    if (from !== null && (facts.state !== from || facts.status !== 'confirmed')) {
      throw refused(LEFT[from]);
    }
    // Q-B5 (a): no refusal while session 1's make-up is pending (the outcome chain «waiting»).
    if (
      noOffer &&
      decision === 'approve' &&
      (await store.assessmentOutcome(tx, facts.enrollmentId)).kind === 'waiting'
    ) {
      throw refused('makeup_pending');
    }
    // 006:T017 (Q-e4 (b), the owner, 2026-11-24): no stop while a paid session can still be given.
    if (
      current.kind === 'stop' &&
      decision === 'approve' &&
      (await store.sessionsPending(tx, facts.enrollmentId))
    ) {
      throw refused('sessions_pending');
    }
    const at = await clock(tx);
    const status = STATUS_OF[decision];
    const written = noOffer && reason !== undefined ? { reason } : {};
    if (!(await store.decideRequest(tx, current.id, { status, adminId, at, ...written }))) {
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
        (keyed) => decideLocked(keyed, adminId, item, input),
      );
      return { answer: outcome, replayed, enrollmentId: item.enrollmentId };
    },
    // 006:T017: the reopen (this file's end).
    reopen: reopenOver(dependencies),
  };
}

// ---------------------------------------------------------------------------------------------
// 006:T017 (FR-725, FR-727; R-513; admin-surface.md `programmes.reopen`; B-P3 lane e's questions,
// the owner's «موافق عالكل», 2026-11-24): THE REOPEN. An administrator's, keyed on the kind's
// transaction (`runOn`, scope `programmes.reopen`). The programme read once with no lock for its
// parties and weekly time (no programme NOT_FOUND); then both accounts (`users`, one call in id order),
// the teacher's slots' key, the slot (`availability_slots`), the programme's row and the
// enrollment's, kernel.md's order, the programme read again under them. Refused `CONFLICT` with its
// cause, nothing written, one line of ids and the cause, never the administrator's words, in
// restore's order: `not_stopped` (a programme no approved stop closed: only `cancelled`
// `programme_stopped`, R-513); `party_restricted` (an account not active, the teacher's approval
// gone); `gender_mismatch` (the two declared genders differ, either way; neither logged);
// `slot_inactive` (the weekly time deactivated or removed since); `slot_taken` (another hold or
// enrollment uses it, booking's occupancy); `time_taken` (Q-e6: either party's session, reserved
// time, open hold or other programme over one of the weekly time's coming weeks, one week per
// session not yet paid, each resolved on its own date). Then the enrollment `confirmed` through
// `reopenStoppedEnrollment` (the confirmation path's third writer: its reason, `slot_released_at` and
// `admin_end_reason` cleared, never `confirmed_at`), the programme `paused` since the reopen's
// instant (a new stop waits the 7 days again), one `programme_reopened` row; no session is written
// (the next month's come once paid). One info line; `enrollment` to both parties after the commit
// on the kind's bound publisher. The router audits `programme.reopened` with the reason.

/** What a reopen answers: the audit's target and whether the key replayed it. */
export interface ProgrammeReopen {
  readonly answer: ProgrammesReopenOutput;
  readonly replayed: boolean;
  readonly enrollmentId: string;
}

/** What the reopen locks, reads and writes, over booking's rows and the owners' entries. */
export interface ProgrammeReopenStore {
  programmeOf(tx: Transaction, enrollmentId: string): Promise<StoppedProgrammeRow | null>;
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSlot(tx: Transaction, slotId: string): Promise<void>;
  lockProgramme(tx: Transaction, enrollmentId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, SessionPartyRecord>>;
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  /** Whether another hold or enrollment uses the slot at `at` (booking's occupancy, R-205). */
  slotTaken(tx: Transaction, slotId: string, at: Date): Promise<boolean>;
  /** Q-e6: the two parties' busy times in `window` (sessions, reserved times, holds, programmes). */
  busyTimesOf(
    tx: Transaction,
    parties: { readonly studentUserId: string; readonly teacherUserId: string },
    window: { readonly from: Date; readonly to: Date },
  ): Promise<readonly SessionTime[]>;
  reopenEnrollment(tx: Transaction, enrollmentId: string): Promise<boolean>;
  reopenProgramme(tx: Transaction, enrollmentId: string, pausedAt: Date): Promise<boolean>;
  recordReopened(tx: Transaction, enrollmentId: string, occurredAt: Date): Promise<void>;
}

/** The reopen's store over booking's rows, the kernel's locks and the owners' entries. */
export function programmeReopenStoreOver(settings: SettingsReader): ProgrammeReopenStore {
  const release = {
    bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
    windowDays: windowDaysOf(settings),
  };
  // Q-e6: the hold's busy read (both parties' sessions and reserved times, the student's other
  // programmes' weekly times) and the parties' open holds, as restore reads them.
  const sessionsBetween = withProgrammeTimes(partiesBusyBetween);
  const side = createEnrollmentSide({ settings });
  return {
    programmeOf: stoppedProgrammeOf,
    lockAccounts: (tx, userIds) => lockRows(tx, 'users', userIds),
    lockTeacherSlots: (tx, teacherUserId) => lockKey(tx, 'teacher-slots', teacherUserId),
    lockSlot: (tx, slotId) => lockRows(tx, 'availability_slots', [slotId]),
    lockProgramme: (tx, enrollmentId) => lockRows(tx, 'programmes', [enrollmentId]),
    lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
    partiesOf: sessionPartiesOf,
    slotOf: readSlot,
    slotTaken: (tx, slotId, at) => slotInUse(tx, slotId, { ...release, now: () => at }),
    busyTimesOf: async (tx, parties, window) => [
      ...(await sessionsBetween(tx, parties, window)),
      ...(await side.heldTimesOf(tx, [parties.studentUserId, parties.teacherUserId], window)),
    ],
    reopenEnrollment: reopenStoppedEnrollment,
    reopenProgramme: reopenProgrammeRow,
    recordReopened: (tx, enrollmentId, occurredAt) =>
      recordEnrollmentEvents(tx, [{ kind: 'programme_reopened', enrollmentId, occurredAt }]),
  };
}

/**
 * Q-e6: the weekly time's coming occurrences the reopened programme may still take, one per session
 * not yet paid (the offer's N less four a paid month), from the first one starting after `at`, each
 * resolved on its own date in the enrollment's zone (R-TIME-2), never by adding intervals.
 */
function comingWeeksOf(slot: SlotRow, row: StoppedProgrammeRow, at: Date): readonly Occurrence[] {
  const count = row.offerSessionCount - SESSIONS_PER_PROGRAMME_MONTH * row.monthsPaid;
  if (count <= 0) return [];
  const weekly = {
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    dayOfWeek: slot.dayOfWeek as DayOfWeek,
    startTimeLocal: slot.startTimeLocal,
    durationMinutes: slot.durationMinutes,
    timezone: row.timezone,
  };
  return resolveOccurrences(weekly, {
    fromLocalDate: localDateIn(at, row.timezone),
    count: count + 1,
  })
    .filter(({ startsAt }) => Date.parse(startsAt) > at.getTime())
    .slice(0, count);
}

/** Whether the row is a programme an approved stop closed (R-513: only those are reopened). */
function stoppedByItsStop(row: StoppedProgrammeRow): boolean {
  return (
    row.state === 'closed' &&
    row.status === 'cancelled' &&
    row.cancellationReason === 'programme_stopped'
  );
}

/** `programmes.reopen` over `dependencies` (this section's head). */
function reopenOver(dependencies: ProgrammeDecisionDependencies): ProgrammeDecisions['reopen'] {
  const store = dependencies.reopenStore ?? programmeReopenStoreOver(dependencies.settings);
  const clock = dependencies.clock ?? clockTimestamp;
  const { log } = dependencies;

  const reopenLocked = async (
    tx: Transaction,
    adminId: string,
    seen: StoppedProgrammeRow,
  ): Promise<ProgrammesReopenOutput> => {
    const ids = { adminId, enrollmentId: seen.enrollmentId };
    const refused = (cause: ProgrammesReopenRefusal) =>
      refusal(log, ids, cause, 'A programme reopen was refused');
    await store.lockAccounts(tx, [seen.studentUserId, seen.teacherUserId].sort());
    await store.lockTeacherSlots(tx, seen.teacherUserId);
    await store.lockSlot(tx, seen.slotId);
    await store.lockProgramme(tx, seen.enrollmentId);
    await store.lockEnrollment(tx, seen.enrollmentId);
    const current = await store.programmeOf(tx, seen.enrollmentId);
    if (current === null) throw new DomainError('NOT_FOUND');
    if (!stoppedByItsStop(current)) throw refused('not_stopped');
    // Restore's step 3 (FR-432, R-409): both accounts active, the teacher's approval standing.
    const parties = await store.partiesOf(tx, [current.studentUserId, current.teacherUserId]);
    const student = parties.get(current.studentUserId);
    const teacher = parties.get(current.teacherUserId);
    if (
      student?.accountStatus !== 'active' ||
      teacher?.accountStatus !== 'active' ||
      !teacher.teacherApproved
    ) {
      throw refused('party_restricted');
    }
    // The pairing's two declared genders, read under both accounts' locks; neither is logged.
    if (student.gender !== teacher.gender) throw refused('gender_mismatch');
    const at = await clock(tx);
    const slot = await store.slotOf(tx, current.slotId);
    if (slot === null || !slot.isActive) throw refused('slot_inactive');
    if (await store.slotTaken(tx, current.slotId, at)) throw refused('slot_taken');
    // Q-e6: the coming weeks against either party's other bookings, as restore reads them.
    const weeks = comingWeeksOf(slot, current, at);
    if (weeks.length > 0) {
      const busy = await store.busyTimesOf(
        tx,
        { studentUserId: current.studentUserId, teacherUserId: current.teacherUserId },
        windowOfRuns([weeks]),
      );
      if (overlapsAny(weeks, busy)) throw refused('time_taken');
    }
    if (!(await store.reopenEnrollment(tx, current.enrollmentId))) {
      throw new Error('programmes.reopen: a stopped enrollment read under its lock did not move');
    }
    if (!(await store.reopenProgramme(tx, current.enrollmentId, at))) {
      throw new Error('programmes.reopen: a closed programme read under its lock did not move');
    }
    await store.recordReopened(tx, current.enrollmentId, at);
    log.info({ ...ids, reason: 'reopened' }, 'A programme was reopened');
    publisherOn(tx)?.afterCommit([current.studentUserId, current.teacherUserId], {
      type: 'enrollment',
      enrollmentId: current.enrollmentId,
    });
    return { state: 'paused' };
  };

  return async (tx, adminId, { idempotencyKey, ...input }) => {
    const seen = await store.programmeOf(tx, input.enrollmentId);
    if (seen === null) throw new DomainError('NOT_FOUND');
    const { outcome, replayed } = await dependencies.idempotency.runOn<ProgrammesReopenOutput>(
      tx,
      { scope: 'programmes.reopen', key: idempotencyKey, actorId: adminId, input },
      (keyed) => reopenLocked(keyed, adminId, seen),
    );
    return { answer: outcome, replayed, enrollmentId: seen.enrollmentId };
  };
}
