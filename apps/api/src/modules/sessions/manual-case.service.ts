// T064 of specs/004-sessions/tasks.md (FR-471 (c), FR-493, FR-470, FR-480, FR-495; SRS FR-ADMIN-20
// (c); research R-326 and R-323's GAP-5; contracts/admin-surface.md, `cases.openManual`;
// contracts/kernel.md, the two manual-case rows; the notes under T064): an administrator's manual
// compensation case, on the administrator call's transaction. Any enrollment, in any state
// (`pending_payment`, `confirmed`, `completed`, `terminated_no_show`, `cancelled`), read through
// `EnrollmentSide` (sessions reads no booking table, R-301). The case is moderation's
// `openCompensationCase` with `admin_opened_for_student` or `admin_opened_for_teacher` by the party:
// one open case per enrollment and reason, so a second opening for the same party while its case is
// open joins it (`joined`, no row written). The administrator's reason is the audit entry's, the
// router's. Nothing here computes, stores or moves an amount (R-MONEY-6).
//
// WITH `remedyId` (a remedy is owed to the student; the input schema refuses it with `party:
// 'teacher'`): the remedy is read with no lock, and one that is none or of another enrollment is
// refused `NOT_FOUND` before any lock, since a remedy's enrollment never changes (the note under
// T064, F6). It is then handed to the student's manual case through T030's `handOff` with the reason
// `admin_opened_for_student`, from any of the four open states, `frozen` included, its `kind` left
// as it is: `refund_case`, `case_id`, `decided_at`, a pending counter's five columns cleared, so both
// reserved times return to booking at once (H3), one `session_events` row `remedy_handed_to_case`;
// a remedy `booked`, `refund_case` or `lapsed` is refused `REMEDY_NOT_OPEN` there. The case it opens
// or joins is the answer's (`joined` is its `caseOpened` negated). The hand-off releases times and
// books none (R-320).
//
// KEYED ON THE CALL'S TRANSACTION (ADR 0008; the note under T064, Q1 (a), and the one under T059):
// the kernel's `IdempotencyService.runOn`, scope `cases.openManual`, the administrator as actor,
// the input without its key as what was asked. The key is claimed before any lock, so a duplicate
// waits on the first claim holding no lock of the one order. A repeat answers the first result,
// `replayed`, and writes nothing; the router then marks the call a replay and records no entry. The
// same key with another input is the kernel's `CONFLICT`. A refusal rolls the claim back with the
// call.
//
// THE LOCKS (contracts/kernel.md, the two manual-case rows; T005's rules). No remedy: the
// enrollment's row first, the case's own lock (`lockCasesOf`, moderation's
// `compensation-case.repository.ts`, which its entry does not export; the same `lockRows` on
// `enrollments` through `EnrollmentSide.lockEnrollments`), the enrollment read again under it, then
// `disputes` through `openCompensationCase`, whose own enrollment lock is the one already held.
// With a remedy: the enrollment and the remedy read with no lock, then `handOff`'s order (`users`,
// both, one call; `lockKey('teacher-slots')`; `enrollments`; `sessions`; `session_remedies`, the
// remedy read again; `disputes`). The case references the enrollment only (`raised_by_user_id`
// NULL); the event the enrollment and the session, both held.
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and its cause, marked «logged»:
// this file's `refusal` for an enrollment or a remedy not found, `handOff`'s for a remedy not open.
// The opening is the administrator's action and its audit entry is the record; it writes no line.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import { type CompensationCase, openCompensationCase } from '../moderation/index.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { type RemedyToHandOff, remedyToHandOff } from './remedy-case.repository.js';
import { createRemedyCase, type RemedyCase } from './remedy-case.service.js';

/** The keyed procedure (`packages/contracts`, `idempotent-procedures.ts`). */
const SCOPE = 'cases.openManual';

/** Whose case the administrator opens; the party is the reason (R-326). */
export type ManualCaseParty = 'student' | 'teacher';

const REASON_OF = {
  student: 'admin_opened_for_student',
  teacher: 'admin_opened_for_teacher',
} as const satisfies Record<ManualCaseParty, string>;

export interface ManualCaseInput {
  readonly enrollmentId: string;
  readonly party: ManualCaseParty;
  /** The administrator's reason; the audit entry's, not the case's. */
  readonly reason: string;
  readonly idempotencyKey: string;
  /** Only with `party: 'student'` (the input schema's rule). */
  readonly remedyId?: string;
}

/**
 * `cases.openManual`'s answer, as the contract's output gives it; stored on the key's row and
 * replayed as JSON (a type, not an interface, so it is one of the kernel's `JsonValue`s).
 */
export type ManualCaseAnswer = {
  readonly caseId: string;
  readonly enrollmentId: string;
  readonly party: ManualCaseParty;
  readonly status: 'open';
  readonly joined: boolean;
  readonly handedRemedy?: { readonly remedyId: string; readonly sessionId: string };
};

/** What a call answered, and whether it was replayed from its key's row. */
export interface ManualCaseOutcome {
  readonly answer: ManualCaseAnswer;
  readonly replayed: boolean;
}

export interface ManualCaseService {
  /** `cases.openManual` on the administrator call's transaction (this file's head). */
  openManual(tx: Transaction, adminId: string, input: ManualCaseInput): Promise<ManualCaseOutcome>;
}

/** What the opening reads and writes beside `EnrollmentSide` and `handOff`; faked in a spec. */
export interface ManualCaseStore {
  /** The remedy and its session's enrollment; no lock. */
  remedyToHandOff(tx: Transaction, remedyId: string): Promise<RemedyToHandOff | null>;
  /** The enrollment's case of the reason, opened or joined (moderation's). */
  openCase(
    tx: Transaction,
    enrollmentId: string,
    reason: (typeof REASON_OF)[ManualCaseParty],
  ): Promise<CompensationCase>;
}

/** The store over sessions' table and moderation's entry (R-API-6). */
export const manualCaseStore: ManualCaseStore = {
  remedyToHandOff,
  openCase: openCompensationCase,
};

/** Why an opening was refused, as its one line names it. */
type RefusalCause = 'no_enrollment' | 'no_remedy' | 'not_of_enrollment';

/**
 * Logs the refusal with ids and its cause only, and answers the error to throw, marked «logged» so
 * `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: { readonly adminId: string; readonly enrollmentId: string; readonly remedyId?: string },
  reason: RefusalCause,
): DomainError {
  log.info({ ...ids, errorCode: 'NOT_FOUND', reason }, 'A manual case was refused');
  return markRefusalLogged(new DomainError('NOT_FOUND'));
}

export interface ManualCaseDependencies {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentFor' | 'lockEnrollments'>;
  /** The kernel's idempotency, keyed on the call's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** For the refusals' lines. */
  readonly log: Pick<Logger, 'info'>;
  readonly store?: ManualCaseStore;
  /** T030's hand-off; its own store and the database's clock by default. */
  readonly remedyCase?: RemedyCase;
}

export function createManualCase({
  enrollments,
  idempotency,
  log,
  store = manualCaseStore,
  remedyCase = createRemedyCase({ log }),
}: ManualCaseDependencies): ManualCaseService {
  /** No remedy: the enrollment's lock, the enrollment again under it, then the case. */
  const openFor = async (
    tx: Transaction,
    adminId: string,
    enrollmentId: string,
    party: ManualCaseParty,
  ): Promise<ManualCaseAnswer> => {
    await enrollments.lockEnrollments(tx, [enrollmentId]);
    if ((await enrollments.enrollmentFor(tx, enrollmentId)) === null) {
      throw refusal(log, { adminId, enrollmentId }, 'no_enrollment');
    }
    const { caseId, opened } = await store.openCase(tx, enrollmentId, REASON_OF[party]);
    return { caseId, enrollmentId, party, status: 'open', joined: !opened };
  };

  /** With a remedy: both read with no lock, then T030's hand-off in its own order. */
  const handFor = async (
    tx: Transaction,
    adminId: string,
    enrollmentId: string,
    remedyId: string,
  ): Promise<ManualCaseAnswer> => {
    if ((await enrollments.enrollmentFor(tx, enrollmentId)) === null) {
      throw refusal(log, { adminId, enrollmentId, remedyId }, 'no_enrollment');
    }
    const remedy = await store.remedyToHandOff(tx, remedyId);
    if (remedy === null) throw refusal(log, { adminId, enrollmentId, remedyId }, 'no_remedy');
    if (remedy.enrollmentId !== enrollmentId) {
      throw refusal(log, { adminId, enrollmentId, remedyId }, 'not_of_enrollment');
    }
    const handed = await remedyCase.handOff(tx, { remedyId, reason: REASON_OF.student });
    return {
      caseId: handed.caseId,
      enrollmentId,
      party: 'student',
      status: 'open',
      joined: !handed.caseOpened,
      handedRemedy: { remedyId, sessionId: handed.sessionId },
    };
  };

  return {
    openManual: async (tx, adminId, { idempotencyKey, ...asked }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        { scope: SCOPE, key: idempotencyKey, actorId: adminId, input: asked },
        (inner) =>
          asked.remedyId === undefined
            ? openFor(inner, adminId, asked.enrollmentId, asked.party)
            : handFor(inner, adminId, asked.enrollmentId, asked.remedyId),
      );
      return { answer: outcome, replayed };
    },
  };
}
