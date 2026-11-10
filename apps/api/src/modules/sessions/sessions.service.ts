// T011 of specs/004-sessions: `sessions.get` and `sessions.join` (FR-431, FR-432, FR-434, FR-435,
// FR-436, FR-482, FR-494, FR-499; R-GENDER-7, R-SESS-5, R-HONEST-4, R-SEC-2; contracts/app-surface.md,
// "`sessions`"; contracts/kernel.md, the `sessions.join` row).
//
// WHO MAY READ OR JOIN (FR-432, R-GENDER-2). The caller's own id finds the session together with its
// party, so another person's session and a nonexistent one answer the same `NOT_FOUND`. The two
// accounts are then read from identity's records, and a counterparty of the other gender answers
// that `NOT_FOUND` too: the server's record, never the caller's session or input (R-GENDER-4). A
// deleted counterparty has no record to compare and is named by the stand-in, as T007 names a
// deleted party (`{ displayName: null, deleted: true }`, FR-426).
//
// THE READ (FR-434, FR-494). One read transaction, no lock: the session's local date, local start
// and zone beside its instants, its length from the enrollment's snapshot through `EnrollmentSide`
// (FR-424; sessions reads no booking table), the join period, and the counterparty's display name
// and nothing else of them (R-HONEST-4): no date of birth, minor flag, document or dispute history is
// read. `cancellation`, `remedy`, `dispute`, `canRaiseDispute` and `disputeClosesAt` are T021's,
// T028's and T026's. T021: `cancellation` is the session's latest request, read on the same
// transaction, a stored `pending` answered `expired` from the start and once the session is no
// longer `scheduled` (`cancellation.service.ts`, `cancellationViewOf`). T026 (joined at B37's
// integration, after T021's): `dispute`, `canRaiseDispute` and `disputeClosesAt` for the caller, read
// on the same transaction through the dispute view (`dispute-view.ts`), with no lock.
//
// T021: `sessions.cancellation.request` and `.answer` are `cancellation.service.ts`', composed here
// so the surface reaches them as `services.sessions.cancellation`.
//
// THE JOIN (FR-431, FR-432, FR-482, R-SESS-5; kernel.md, the `sessions.join` row: `users` (both, one
// call) only, no `sessions` row locked and none written). The session is read once to learn its
// parties, both accounts are locked in one `lockRows(tx, 'users', …)` call, and the session and both
// accounts are read again under the locks (T005's rule 1), so a suspension, a ban, a revocation or
// a gender correction committed before the lock is what the join reads (K2). Then, in this order:
// the other gender `NOT_FOUND`; either account not active, deleted, or the teacher's approval not
// standing `ACCOUNT_RESTRICTED` (no details: which party it is stays the server's); a session no
// longer `scheduled` `SESSION_NOT_SCHEDULED`; before `startsAt − early_join_lead_minutes`
// `JOIN_NOT_OPEN` with `opensAt`; from `endsAt` `JOIN_CLOSED`. Each refusal throws inside the
// transaction, which rolls back, and writes one info line with the session's and the caller's ids,
// the code and the reason, nothing else, its error marked «logged» (`markRefusalLogged`) so the
// handler's one-place refusal log writes no second line (PR #130's review, Minor 4). The transaction writes nothing: no attendance, no
// `provider_room_id` (the room is named for the session's id; M1).
//
// After the commit, never holding a lock across a provider call: `createRoom` with the timeouts the
// settings `video_empty_timeout_seconds` and `video_departure_timeout_seconds` give (idempotent: a
// rejoin finds the room), then `createSessionToken` bound to the session and the caller until the
// scheduled end (R-GENDER-7, R-302). A rejoin is the same call again (FR-435). The token and its
// credential are answered and never logged: the one line an issued token writes is the two ids.
import type {
  SessionsGetInput,
  SessionsGetOutput,
  SessionsJoinInput,
  SessionsJoinOutput,
} from '@ijazah/contracts';
import { addMinutes } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { VideoPort } from '../../platform/ports/video/video.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { sessionPartiesOf } from '../identity/index.js';
import { type CancellationRequestRow, latestRequestOf } from './cancellation.repository.js';
import {
  type CancellationServices,
  type CancellationStore,
  cancellationViewOf,
  createCancellationServices,
} from './cancellation.service.js';
import { createDisputeRaise, type DisputeRaise, type DisputeRaiseStore } from './dispute-raise.service.js';
import { createDisputeView, type DisputeView } from './dispute-view.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { lockSessionParties, type PartySessionRow, sessionOfParty } from './sessions.repository.js';

/** Minutes before a session's start its join opens (FR-431; SRS §3.14). */
export const EARLY_JOIN_LEAD_SETTING = 'early_join_lead_minutes';
/** Seconds a room waits for its first participant (R-302). */
export const VIDEO_EMPTY_TIMEOUT_SETTING = 'video_empty_timeout_seconds';
/** Seconds a room waits after its last participant leaves (R-302). */
export const VIDEO_DEPARTURE_TIMEOUT_SETTING = 'video_departure_timeout_seconds';

const wholeMinutes = z.int().nonnegative();
const positiveSeconds = z.int().positive();

/** The account's standing (ERD §2, `users.account_status`). */
export type PartyAccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

/** What the server's records say of one live party of a session (FR-432). */
export interface PartyStanding {
  readonly gender: 'male' | 'female';
  readonly accountStatus: PartyAccountStatus;
  /** Whether the account's teacher approval stands (`verification_status = 'approved'`). */
  readonly teacherApproved: boolean;
  readonly displayName: string;
}

/** What the session read and the join read, each on the caller's transaction; faked in a spec. */
export interface SessionsStore {
  /** The session when `userId` is one of its two parties, else null; no lock. */
  sessionOfParty(
    tx: Transaction,
    sessionId: string,
    userId: string,
  ): Promise<PartySessionRow | null>;
  /** Both accounts, `FOR UPDATE`, in one call (kernel.md, the `sessions.join` row). */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The live accounts of `userIds` from identity's records; a deleted one is absent. */
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, PartyStanding>>;
  /** T021: the session's latest cancellation request, whatever its status, else null; no lock. */
  latestCancellationOf(tx: Transaction, sessionId: string): Promise<CancellationRequestRow | null>;
}

/** The store over this module's reads and lock and identity's accounts (R-API-6), as `main.ts` binds it. */
export const sessionsStore: SessionsStore = {
  sessionOfParty,
  lockAccounts: lockSessionParties,
  partiesOf: sessionPartiesOf,
  latestCancellationOf: latestRequestOf,
};

/** The person asking, from the server-held session. */
export interface SessionsCaller {
  readonly userId: string;
}

/** `sessions.get` and `sessions.join`, each one transaction on the process's client. */
export interface SessionsServices extends DisputeRaise {
  get(caller: SessionsCaller, input: SessionsGetInput, log: Logger): Promise<SessionsGetOutput>;
  join(caller: SessionsCaller, input: SessionsJoinInput, log: Logger): Promise<SessionsJoinOutput>;
  /** T021: `sessions.cancellation.request` and `.answer`. */
  readonly cancellation: CancellationServices;
}

export interface SessionsDependencies {
  readonly transactions: Transactions;
  readonly settings: SettingsReader;
  readonly video: VideoPort;
  readonly enrollmentSide: EnrollmentSide;
  readonly store: SessionsStore;
  /**
   * The kernel's idempotency, which keys `sessions.cancellation.request` (T021) and runs
   * `sessions.dispute.raise` in its transaction (T026).
   */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  /** T021: the cancellation's store; the module's unless a spec fakes it. */
  readonly cancellationStore?: CancellationStore;
  /** T026: the raise's store; `disputeRaiseStore` unless a spec narrows it. */
  readonly disputeStore?: DisputeRaiseStore;
  /** T026: `sessions.get`'s dispute fields; `createDisputeView({ settings })` unless a spec fakes it. */
  readonly disputeView?: DisputeView;
  readonly now?: () => Date;
}

/** Why a read or a join was refused, as its one log line names it. */
type RefusalReason =
  | 'not_a_party'
  | 'gender_differs'
  | 'party_not_active'
  | 'teacher_not_approved'
  | 'not_scheduled'
  | 'before_open'
  | 'after_end';

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked as logged so
 * the handler's one-place refusal log writes no second line (PR #130's review, Minor 4).
 */
function refusal(
  log: Logger,
  ids: { readonly sessionId: string; readonly userId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
  // The shape of DomainError's own options (`domain-error.ts:144`), written out so no literal index is.
  details?: { readonly details?: readonly FieldIssue[]; readonly cause?: unknown },
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A session read or join was refused');
  return markRefusalLogged(new DomainError(errorCode, undefined, details));
}

/** The session and its two parties as the server's records hold them, or the refusal. */
interface Seen {
  readonly session: PartySessionRow;
  readonly counterpartyId: string;
  readonly counterparty: PartyStanding | undefined;
  readonly own: PartyStanding | undefined;
}

/** The session's two parties, read; the other gender refused as a nonexistent session. */
async function partiesSeen(
  tx: Transaction,
  store: SessionsStore,
  session: PartySessionRow,
  userId: string,
  log: Logger,
): Promise<Seen> {
  const counterpartyId =
    session.studentUserId === userId ? session.teacherUserId : session.studentUserId;
  const parties = await store.partiesOf(tx, [session.studentUserId, session.teacherUserId]);
  const own = parties.get(userId);
  const counterparty = parties.get(counterpartyId);
  const ids = { sessionId: session.id, userId };
  if (own === undefined) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
  if (counterparty !== undefined && counterparty.gender !== own.gender) {
    throw refusal(log, ids, 'NOT_FOUND', 'gender_differs');
  }
  return { session, counterpartyId, counterparty, own };
}

export function createSessionsServices({
  transactions,
  settings,
  video,
  enrollmentSide,
  store,
  idempotency,
  cancellationStore,
  disputeStore,
  disputeView = createDisputeView({ settings }),
  now = () => new Date(),
}: SessionsDependencies): SessionsServices {
  const leadMinutes = () => settings.read(EARLY_JOIN_LEAD_SETTING, wholeMinutes);
  const opensAtOf = (session: PartySessionRow, lead: number) =>
    new Date(addMinutes(session.startsAt, -lead));
  // T026: `sessions.dispute.raise` (`dispute-raise.service.ts`).
  const { raiseDispute } = createDisputeRaise({
    idempotency,
    settings,
    enrollments: enrollmentSide,
    ...(disputeStore === undefined ? {} : { store: disputeStore }),
  });

  return {
    raiseDispute,
    get: async ({ userId }, { sessionId }, log) => {
      const lead = await leadMinutes();
      return transactions.run(async (tx) => {
        const session = await store.sessionOfParty(tx, sessionId, userId);
        if (session === null) {
          throw refusal(log, { sessionId, userId }, 'NOT_FOUND', 'not_a_party');
        }
        const { counterparty } = await partiesSeen(tx, store, session, userId, log);
        const terms = await enrollmentSide.enrollmentFor(tx, session.enrollmentId);
        // `sessions.enrollment_id` is a foreign key to the enrollment (ERD `sessions`).
        if (terms === null) throw new Error('sessions: a session without its enrollment');
        const request = await store.latestCancellationOf(tx, session.id);
        const { id, status, endsAt } = session;
        const disputes = await disputeView.ofSessions(tx, [{ id, status, endsAt }], userId);
        return {
          sessionId: session.id,
          enrollmentId: session.enrollmentId,
          sequenceNumber: session.sequenceNumber,
          ...(session.makeupForSequenceNumber === null
            ? {}
            : { makeupFor: { sequenceNumber: session.makeupForSequenceNumber } }),
          localDate: session.localDate,
          startTimeLocal: session.startTimeLocal.slice(0, -SECONDS.length),
          timezone: session.timezone,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          lengthMinutes: terms.durationMinutes as SessionsGetOutput['lengthMinutes'],
          status: session.status,
          counterparty:
            counterparty === undefined
              ? { displayName: null, deleted: true }
              : { displayName: counterparty.displayName, deleted: false },
          join: {
            opensAt: opensAtOf(session, lead).toISOString(),
            closesAt: session.endsAt.toISOString(),
          },
          ...(request === null
            ? {}
            : { cancellation: cancellationViewOf(request, session, userId, now()) }),
          ...disputes.get(session.id),
        };
      });
    },

    cancellation: createCancellationServices({
      transactions,
      idempotency,
      enrollments: enrollmentSide,
      ...(cancellationStore === undefined ? {} : { store: cancellationStore }),
    }),

    join: async ({ userId }, { sessionId }, log) => {
      const lead = await leadMinutes();
      const at = now();
      const session = await transactions.run(async (tx) => {
        const seen = await store.sessionOfParty(tx, sessionId, userId);
        if (seen === null) throw refusal(log, { sessionId, userId }, 'NOT_FOUND', 'not_a_party');
        // Both in one call, in id order (kernel.md, the `sessions.join` row; row-lock.ts, rule 2).
        await store.lockAccounts(tx, [seen.studentUserId, seen.teacherUserId].sort());
        const locked = await store.sessionOfParty(tx, sessionId, userId);
        if (locked === null) {
          throw refusal(log, { sessionId, userId }, 'NOT_FOUND', 'not_a_party');
        }
        const ids = { sessionId, userId };
        const { counterparty, own, counterpartyId } = await partiesSeen(
          tx,
          store,
          locked,
          userId,
          log,
        );
        const parties = [
          [userId, own],
          [counterpartyId, counterparty],
        ] as const;
        if (parties.some(([, party]) => party?.accountStatus !== 'active')) {
          throw refusal(log, ids, 'ACCOUNT_RESTRICTED', 'party_not_active');
        }
        const teacher = parties.find(([id]) => id === locked.teacherUserId)?.[1];
        if (teacher?.teacherApproved !== true) {
          throw refusal(log, ids, 'ACCOUNT_RESTRICTED', 'teacher_not_approved');
        }
        if (locked.status !== 'scheduled') {
          throw refusal(log, ids, 'SESSION_NOT_SCHEDULED', 'not_scheduled');
        }
        const opensAt = opensAtOf(locked, lead);
        if (at.getTime() < opensAt.getTime()) {
          throw refusal(log, ids, 'JOIN_NOT_OPEN', 'before_open', {
            details: [{ path: 'opensAt', code: opensAt.toISOString() }],
          });
        }
        if (at.getTime() >= locked.endsAt.getTime()) {
          throw refusal(log, ids, 'JOIN_CLOSED', 'after_end');
        }
        return locked;
      });

      const [emptyTimeoutSeconds, departureTimeoutSeconds] = await Promise.all([
        settings.read(VIDEO_EMPTY_TIMEOUT_SETTING, positiveSeconds),
        settings.read(VIDEO_DEPARTURE_TIMEOUT_SETTING, positiveSeconds),
      ]);
      await video.createRoom(session.id, { emptyTimeoutSeconds, departureTimeoutSeconds });
      const token = await video.createSessionToken(session.id, userId, {
        validUntil: session.endsAt,
      });
      log.info({ sessionId: session.id, userId }, 'A join token was issued');
      return {
        sessionId: token.sessionId,
        serverUrl: token.serverUrl,
        token: token.credential,
        validUntil: session.endsAt.toISOString(),
      };
    },
  };
}
