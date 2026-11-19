// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; the note under T112, the
// owner's Q-1 (a) to Q-3 (a) of 2026-11-19; contracts/kernel.md, «a postponement»): `sessions.postpone`.
//
// WHO (FR-POSTPONE-1, R-GENDER-2). Either party of a `confirmed` enrollment, without the other's
// consent. The caller names the enrollment; one who is not its party, and an enrollment that does
// not exist, answer the same `NOT_FOUND`, and so does a counterparty of the other gender by the
// server's records, read under the locks as the join reads it (R-GENDER-4). Either account not
// active answers `ACCOUNT_RESTRICTED`, with no details, as `sessions.join` does; an enrollment no
// longer `confirmed` `CONFLICT`, `details.cause` `enrollment_not_confirmed`.
//
// THE WEEK (Q-1 (a)). The enrollment's `scheduled` sessions, make-ups included, starting from the
// database's clock + `postponement_notice_hours` to the clock + 7 days, both ends included; one
// nearer than the notice stands under the ordinary attendance rules (FR-POSTPONE-3). A week is seven
// days of 24 hours from the instant (`weeksAfter`). None left: `CONFLICT` `no_session_in_week`. The
// choice window of each make-up, opened at the same instant, ends at or after the week's end, so no
// time inside the week is ever offered (the owner's hidden-times rule of 2026-11-05).
//
// THE INTERVAL (FR-POSTPONE-4, Q-3 (a)). Once per `postponement_interval_weeks` per party per
// enrollment, counted from that party's last request on it, read again under the `users` locks: a
// request before its end `CONFLICT` `interval_not_passed`; at its end admitted.
//
// THE LOCKS (kernel.md, «a postponement»: «cancellation accepted»'s row without the request). `users`
// (both parties, one call, id order), the teacher's `lockKey('teacher-slots')`, `enrollments`, then
// the week's `sessions` (one call, id order) and their `session_remedies`, and last the insert,
// whose foreign keys reference the enrollment and the requester, both held. The enrollment, both
// accounts, the clock and the interval are read under the `users` and `enrollments` locks; the
// week's sessions are read again under their own (T005's rule 1). The make-up each moved session is
// owed is offered on this transaction under these locks, by T028's `offerLocked`, the order an
// accepted cancellation holds.
//
// WHAT IS WRITTEN. One `session_postponements` row with the reason (rule 65; never changed after);
// each session of the week `postponed`, naming it (rule 66), which frees both parties' time (rule
// 19) and is never evaluated; one `session_events` row `postponed` per session at the clock read
// under the locks; each session's make-up offered (FR-POSTPONE-2). Keyed by the kernel's
// idempotency (`sessions.postpone`), so a retry with the same key answers the first outcome and
// writes nothing. No push (`NotificationWriter` takes DEC-70's and DEC-71's seven kinds only): the
// other party is told on the live channel, `session` for each session and `enrollment` once, inside
// the keyed effect, so a replay tells nothing (FR-POSTPONE-5).
//
// THE LOG (FR-POSTPONE-5; the owner's rule). Every refusal writes one info line with the enrollment,
// the caller, the code and the reason code; a postponement one line with its id, the enrollment, the
// caller and the sessions, after the commit, and each offer its own (`offeredLine`). Never the reason
// the person wrote.
import type { SessionsPostponeInput, SessionsPostponeOutput } from '@ijazah/contracts';
import { addHours, addWeeks } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { sessionPartiesOf } from '../identity/index.js';
import { lockRemediesOf, lockSessions, lockTeacherSlots } from './cancellation.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import {
  insertPostponement,
  lastPostponementAt,
  type PostponementWeek,
  postponeSessions,
  type WeekSession,
  weekSessionsOf,
} from './postponement.repository.js';
import { type Offered, offeredLine, type RemedyOffer } from './remedy-offer.service.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';
import { lockSessionParties } from './sessions.repository.js';
import type { PartyStanding } from './sessions.service.js';

/** Hours before each session a postponement must be asked (FR-POSTPONE-3; SRS §3.14, 12). */
export const POSTPONEMENT_NOTICE_SETTING = 'postponement_notice_hours';
/** Weeks between a party's postponements of one enrollment (FR-POSTPONE-4; SRS §3.14, 4). */
export const POSTPONEMENT_INTERVAL_SETTING = 'postponement_interval_weeks';

/** Both settings' read-site schema: a whole number, at least 1 (the registry's `positiveWhole`). */
const atLeastOne = z.int().positive();

/** The week a postponement covers is one week (FR-POSTPONE-1, «at most seven days»). */
const ONE_WEEK = 1;

/**
 * The instant `weeks` weeks of seven days of 24 hours after `at` (`packages/time`'s `addWeeks`,
 * R-TIME-1): an instant's week, so no clock change moves it.
 */
export function weeksAfter(at: Date, weeks: number): Date {
  return new Date(addWeeks(at, weeks));
}

/** The sessions a request at `at` covers (Q-1 (a)): from `at` + the notice to `at` + 7 days. */
export function postponementWeek(at: Date, noticeHours: number): PostponementWeek {
  return { from: new Date(addHours(at, noticeHours)), to: weeksAfter(at, ONE_WEEK) };
}

/** Whether a party whose last request was at `last` may ask again at `at` (FR-POSTPONE-4). */
export function intervalPassed(last: Date | null, at: Date, weeks: number): boolean {
  return last === null || at.getTime() >= weeksAfter(last, weeks).getTime();
}

/** What the postponement reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface PostponementStore {
  /** The live accounts of `userIds` from identity's records; a deleted one is absent. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PartyStanding>>;
  /** Both accounts, `FOR UPDATE`, in one call. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The teacher's `lockKey('teacher-slots')`. */
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSessions(tx: Transaction, ids: readonly string[]): Promise<void>;
  /** The session's remedy rows, `FOR UPDATE`. */
  lockRemediesOf(tx: Transaction, sessionId: string): Promise<void>;
  lastPostponementAt(tx: Transaction, enrollmentId: string, userId: string): Promise<Date | null>;
  weekSessionsOf(
    tx: Transaction,
    enrollmentId: string,
    week: PostponementWeek,
    among?: readonly string[],
  ): Promise<readonly WeekSession[]>;
  insertPostponement(
    tx: Transaction,
    row: {
      readonly enrollmentId: string;
      readonly requestedByUserId: string;
      readonly reason: string;
      /** The instant read under the locks (`at`), as the events' `occurred_at`. */
      readonly createdAt: Date;
    },
  ): Promise<string>;
  postponeSessions(
    tx: Transaction,
    ids: readonly string[],
    postponementId: string,
  ): Promise<number>;
  /** T004's writer of `session_events` rows. */
  recordEvents(tx: Transaction, events: readonly SessionEventRecord[]): Promise<void>;
}

/** The store over sessions' tables, the kernel's locks and identity's accounts (R-API-6). */
export const postponementStore: PostponementStore = {
  partiesOf: sessionPartiesOf,
  lockAccounts: lockSessionParties,
  lockTeacherSlots,
  lockSessions,
  lockRemediesOf,
  lastPostponementAt,
  weekSessionsOf,
  insertPostponement,
  postponeSessions,
  recordEvents: recordSessionEvents,
};

/** The person asking, from the server-held session. */
export interface PostponementCaller {
  readonly userId: string;
}

/** `sessions.postpone`; `live` is the request's after-commit list (`ctx.live`). */
export interface Postponement {
  postpone(
    caller: PostponementCaller,
    input: SessionsPostponeInput,
    log: Logger,
    live: LivePublisher,
  ): Promise<SessionsPostponeOutput>;
}

export interface PostponementDependencies {
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments'>;
  readonly settings: SettingsReader;
  /** T028: the make-up each postponed session is owed, offered under the postponement's locks. */
  readonly offer: Pick<RemedyOffer, 'offerLocked'>;
  readonly store?: PostponementStore;
  /** The database's clock on a transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
}

/** Why a postponement was refused, as its one log line names it. */
type RefusalReason =
  | 'not_a_party'
  | 'gender_differs'
  | 'party_not_active'
  | 'enrollment_not_confirmed'
  | 'interval_not_passed'
  | 'no_session_in_week';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged» so
 * `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Logger,
  ids: { readonly enrollmentId: string; readonly userId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
  details?: { readonly details?: readonly FieldIssue[] },
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A postponement was refused');
  return markRefusalLogged(new DomainError(errorCode, undefined, details));
}

/** `CONFLICT` with `details.cause` `cause` (`sessionsPostponeRefusalCause`). */
const conflict = (
  log: Logger,
  ids: { readonly enrollmentId: string; readonly userId: string },
  cause: 'enrollment_not_confirmed' | 'interval_not_passed' | 'no_session_in_week',
) => refusal(log, ids, 'CONFLICT', cause, { details: [{ path: 'cause', code: cause }] });

const SCOPE = 'sessions.postpone';

export function createPostponement({
  idempotency,
  enrollments,
  settings,
  offer,
  store = postponementStore,
  clock = clockTimestamp,
}: PostponementDependencies): Postponement {
  return {
    postpone: async ({ userId }, { idempotencyKey, ...asked }, log, live) => {
      const [noticeHours, intervalWeeks] = await Promise.all([
        settings.read(POSTPONEMENT_NOTICE_SETTING, atLeastOne),
        settings.read(POSTPONEMENT_INTERVAL_SETTING, atLeastOne),
      ]);
      const ids = { enrollmentId: asked.enrollmentId, userId };
      /** Set by the effect alone, so a replay, which runs none, logs nothing. */
      const done: {
        value?: { readonly sessionIds: readonly string[]; readonly offers: Offered[] };
      } = {};

      const output = await idempotency.run(
        { scope: SCOPE, key: idempotencyKey, actorId: userId, input: asked },
        async (tx) => {
          const seen = await enrollments.enrollmentFor(tx, asked.enrollmentId);
          if (seen === null || (seen.studentUserId !== userId && seen.teacherUserId !== userId)) {
            throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
          }
          const parties = [seen.studentUserId, seen.teacherUserId].sort();
          await store.lockAccounts(tx, parties);
          await store.lockTeacherSlots(tx, seen.teacherUserId);
          await enrollments.lockEnrollments(tx, [seen.id]);

          // Under the locks: the enrollment, both accounts, the clock and the interval.
          const terms = await enrollments.enrollmentFor(tx, seen.id);
          // An enrollment is never deleted; its parties never change (ERD `enrollments`).
          if (terms === null) throw new Error('postponement: a locked enrollment vanished');
          const standings = await store.partiesOf(tx, parties);
          const counterpartyId =
            terms.studentUserId === userId ? terms.teacherUserId : terms.studentUserId;
          const own = standings.get(userId);
          const counterparty = standings.get(counterpartyId);
          if (own === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
          if (counterparty !== undefined && counterparty.gender !== own.gender) {
            throw refusal(log, ids, 'NOT_FOUND', 'gender_differs');
          }
          if (own.accountStatus !== 'active' || counterparty?.accountStatus !== 'active') {
            throw refusal(log, ids, 'ACCOUNT_RESTRICTED', 'party_not_active');
          }
          if (terms.status !== 'confirmed') throw conflict(log, ids, 'enrollment_not_confirmed');
          const at = await clock(tx);
          const last = await store.lastPostponementAt(tx, terms.id, userId);
          if (!intervalPassed(last, at, intervalWeeks)) {
            throw conflict(log, ids, 'interval_not_passed');
          }

          // The week's sessions, locked, then read again under their locks.
          const week = postponementWeek(at, noticeHours);
          const candidates = await store.weekSessionsOf(tx, terms.id, week);
          const candidateIds = candidates.map(({ id }) => id);
          if (candidateIds.length > 0) {
            await store.lockSessions(tx, candidateIds);
            for (const id of candidateIds) await store.lockRemediesOf(tx, id);
          }
          const moved =
            candidateIds.length === 0
              ? []
              : (await store.weekSessionsOf(tx, terms.id, week, candidateIds)).map(({ id }) => id);
          if (moved.length === 0) throw conflict(log, ids, 'no_session_in_week');

          const postponementId = await store.insertPostponement(tx, {
            enrollmentId: terms.id,
            requestedByUserId: userId,
            reason: asked.reason,
            // PR #151's review, round 1, nit 1: the interval's «now», not the transaction's start.
            createdAt: at,
          });
          await store.postponeSessions(tx, moved, postponementId);
          await store.recordEvents(
            tx,
            moved.map((sessionId) => ({
              enrollmentId: terms.id,
              sessionId,
              kind: 'postponed' as const,
              occurredAt: at,
            })),
          );
          const offers: Offered[] = [];
          for (const sessionId of moved) {
            const offered = await offer.offerLocked(tx, sessionId);
            if (offered !== null) offers.push(offered);
          }
          // FR-POSTPONE-5: inside the keyed effect, so a replay tells nothing.
          for (const sessionId of moved) {
            live.afterCommit([counterpartyId], {
              type: 'session',
              sessionId,
              enrollmentId: terms.id,
            });
          }
          live.afterCommit([counterpartyId], { type: 'enrollment', enrollmentId: terms.id });
          done.value = { sessionIds: moved, offers };
          return { postponementId, sessionIds: moved };
        },
      );

      if (done.value !== undefined) {
        log.info(
          { postponementId: output.postponementId, ...ids, sessionIds: done.value.sessionIds },
          'Sessions were postponed',
        );
        for (const offered of done.value.offers) offeredLine(log, offered);
      }
      return output;
    },
  };
}
