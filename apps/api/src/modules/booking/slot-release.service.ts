// T070 of specs/004-sessions/tasks.md (FR-503; SRS FR-CANCEL-9, DEC-69; contracts/admin-surface.md,
// `enrollments.releaseSlot`; contracts/kernel.md, the release's row): an administrator releases the
// weekly slot a closed enrollment holds through its window, before the window ends, on the
// administrator call's transaction. The audit entry (`enrollment.slot_released`, with the reason) and
// the limit (`rate_limit_slot_release`, before the transaction) are the router's.
//
// KEYED through the kernel's `IdempotencyService.runOn` on the kind's transaction, as
// `sessions.restore` is: scope `enrollments.releaseSlot`, the administrator as actor, the input
// without its key as what was asked. A repeat answers the first result and writes nothing
// (`replayed`); the same key with another input is the kernel's `CONFLICT`.
//
// THE LOCKS (kernel.md's release row; `003:T005`'s rules, the header of `platform/db/row-lock.ts`).
// The enrollment is read once with no lock for its teacher and slot, which never change. Then the
// teacher's `lockKey('teacher-slots', …)`, the enrollment's slot (`availability_slots`, as a hold and
// the restore take it), and the enrollment, read again under them (rule 1). Its closing case is read
// with no lock of its own: every case closing takes the enrollment's lock first
// (`moderation/compensation-case.service.ts`, «CLOSING A CASE»), which is held. No `users` lock: no
// row written references an account (the `enrollment_events` row references the enrollment only).
// Against a hold (users, then the slot) and the restore (users, the key, the slot, the enrollment)
// the order is the same, so neither waits in a cycle.
//
// WHAT IS REFUSED, each `CONFLICT` with `details.cause` `slot_not_held`, writing nothing, with one
// info line of ids and a reason code: the enrollment not closed (`cancelled` with `confirmed_at` set,
// or `terminated_no_show`), `not_closed`; its closing not restorable by the one closing rule
// (sessions' `closingOf`: its kind, and its case open), `not_restorable`; the hold over (the case's
// opening plus its kind's window, `restorableUntil`, against the database's clock), `hold_over`;
// the slot already released, `already_released`. An enrollment that does not exist is `NOT_FOUND`.
//
// THE WRITES, in the same transaction: `slot_released_at` and one `slot_released` row, both the
// database's instant (`clockTimestamp`); then one info line of ids, never the reason.
//
// THE CORE (T082 of specs/004-sessions; the note under T082, Q-R15 (a)): `releaseHeldSlot(tx,
// enrollmentId, reads)`, the locks, the read again, the refusals (answered as their reason) and the
// writes above, with no key, audit, limit or log of its own, as `restoreClosed` is to
// `sessions.restore`. A direct end with `slot: 'release'` calls it through sessions' `EnrollmentSide`
// port (`releaseHeldSlot`), on its own transaction, every lock already held. `releaseSlot` wraps the
// same core unchanged: keyed through `runOn`, a refusal thrown with its one line.
import type {
  EnrollmentsReleaseSlotInput,
  EnrollmentsReleaseSlotOutput,
} from '@ijazah/contracts/admin';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockKey, lockRows } from '../../platform/db/row-lock.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { compensationCasesOf, type EnrollmentCase } from '../moderation/index.js';
import {
  type ClosingKind,
  closingOf,
  latestEndCaseOf,
  restorableUntil,
  type WindowDays,
  windowDaysOf,
} from '../sessions/index.js';
import { type EnrollmentOutcome, recordEnrollmentEvents } from './enrollment-events.repository.js';
import {
  type HeldEnrollment,
  heldEnrollmentOf,
  markSlotReleased,
} from './slot-release.repository.js';

export type { HeldEnrollment } from './slot-release.repository.js';

/** What the release locks, reads and writes; faked in a spec. */
export interface SlotReleaseStore {
  enrollmentOf(tx: Transaction, enrollmentId: string): Promise<HeldEnrollment | null>;
  lockTeacherSlots(tx: Transaction, teacherUserId: string): Promise<void>;
  lockSlot(tx: Transaction, slotId: string): Promise<void>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  /** Moderation's: the enrollment's compensation cases, newest first, with no lock. */
  casesOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentCase[]>;
  markReleased(tx: Transaction, enrollmentId: string, at: Date): Promise<boolean>;
  recordEvents(tx: Transaction, outcomes: readonly EnrollmentOutcome[]): Promise<void>;
}

/** The store over booking's rows, the kernel's locks and moderation's entry (R-API-6). */
export const slotReleaseStore: SlotReleaseStore = {
  enrollmentOf: heldEnrollmentOf,
  lockTeacherSlots: (tx, teacherUserId) => lockKey(tx, 'teacher-slots', teacherUserId),
  lockSlot: (tx, slotId) => lockRows(tx, 'availability_slots', [slotId]),
  lockEnrollment: (tx, enrollmentId) => lockRows(tx, 'enrollments', [enrollmentId]),
  casesOf: compensationCasesOf,
  markReleased: markSlotReleased,
  recordEvents: recordEnrollmentEvents,
};

export interface SlotReleaseDependencies {
  /** The kernel's idempotency, keyed on the call's transaction (`runOn`). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'runOn'>;
  /** The two window settings, read through sessions' `windowDaysOf` when the closing needs one. */
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SlotReleaseStore;
}

export interface HeldSlotRelease {
  /** `enrollments.releaseSlot` on the administrator call's transaction (this file's head). */
  releaseSlot(
    tx: Transaction,
    adminId: string,
    input: EnrollmentsReleaseSlotInput,
  ): Promise<{ readonly answer: EnrollmentsReleaseSlotOutput; readonly replayed: boolean }>;
}

interface RefusalIds {
  readonly adminId: string;
  readonly enrollmentId: string;
}

const REFUSED = 'A held slot release was refused';
const SCOPE = 'enrollments.releaseSlot';

/** The refusal's error, marked «logged» after its one line of ids and its reason. */
function notHeld(log: Pick<Logger, 'info'>, ids: RefusalIds, reason: NotHeld): DomainError {
  log.info({ ...ids, errorCode: 'CONFLICT', cause: 'slot_not_held', reason }, REFUSED);
  return markRefusalLogged(
    new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: 'slot_not_held' }] }),
  );
}

function notFound(log: Pick<Logger, 'info'>, ids: RefusalIds): DomainError {
  log.info({ ...ids, errorCode: 'NOT_FOUND', cause: 'not_found' }, REFUSED);
  return markRefusalLogged(new DomainError('NOT_FOUND'));
}

/** A closing a payment confirmed: `cancelled` with `confirmed_at` set, or `terminated_no_show`. */
const isClosed = ({ status, confirmedAt }: HeldEnrollment): boolean =>
  status === 'terminated_no_show' || (status === 'cancelled' && confirmedAt !== null);

/** Why a release was refused, as its one log line names it. */
type NotHeld = 'not_closed' | 'not_restorable' | 'hold_over' | 'already_released';

/**
 * T082 (the note under T082, Q-R15 (a)): what the release's core answers: the slot released at the
 * database's instant with its closing's case and kind, or why it was not, nothing written.
 */
export type HeldRelease =
  | {
      readonly released: true;
      readonly at: Date;
      readonly caseId: string;
      readonly kind: ClosingKind;
    }
  | { readonly released: false; readonly reason: NotHeld | 'not_found' };

/** T082: what the core reads its window and its instant through, and its store. */
export interface HeldReleaseReads {
  /** The two window settings, read when the closing needs one (sessions' `windowDaysOf`). */
  readonly windowDays: WindowDays;
  /** The database's clock on the call's transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SlotReleaseStore;
}

/**
 * T082 (Q-R15 (a)): the release's core, on the caller's transaction, with no key, audit, limit or log
 * of its own, as `restoreClosed` is to `sessions.restore`: this file's locks, in its order (a direct
 * end holds them all already, so it never waits), the enrollment read again under them, the checks
 * and the writes of this file's head. `enrollments.releaseSlot` wraps it, keyed, with its lines.
 */
export async function releaseHeldSlot(
  tx: Transaction,
  enrollmentId: string,
  { windowDays, clock = clockTimestamp, store = slotReleaseStore }: HeldReleaseReads,
): Promise<HeldRelease> {
  const seen = await store.enrollmentOf(tx, enrollmentId);
  if (seen === null) return { released: false, reason: 'not_found' };
  await store.lockTeacherSlots(tx, seen.teacherUserId);
  await store.lockSlot(tx, seen.slotId);
  await store.lockEnrollment(tx, enrollmentId);
  const enrollment = await store.enrollmentOf(tx, enrollmentId);
  if (enrollment === null) return { released: false, reason: 'not_found' };
  if (!isClosed(enrollment)) return { released: false, reason: 'not_closed' };
  const closing = closingOf({
    status: enrollment.status,
    lastCancellationReason: enrollment.cancellationReason,
    endCase: latestEndCaseOf(await store.casesOf(tx, enrollmentId)),
  });
  if (closing === undefined || !closing.restorable) {
    return { released: false, reason: 'not_restorable' };
  }
  const [now, until] = await Promise.all([
    clock(tx),
    restorableUntil(closing.closingCase.createdAt, closing.kind, windowDays),
  ]);
  if (now.getTime() >= until.getTime()) return { released: false, reason: 'hold_over' };
  if (enrollment.slotReleasedAt !== null) return { released: false, reason: 'already_released' };

  if (!(await store.markReleased(tx, enrollmentId, now))) {
    throw new Error('releaseSlot: the enrollment, read unreleased under its lock, did not update');
  }
  await store.recordEvents(tx, [{ kind: 'slot_released', enrollmentId, occurredAt: now }]);
  return { released: true, at: now, caseId: closing.closingCase.caseId, kind: closing.kind };
}

export function createHeldSlotRelease({
  idempotency,
  settings,
  log,
  clock = clockTimestamp,
  store = slotReleaseStore,
}: SlotReleaseDependencies): HeldSlotRelease {
  const windowDays = windowDaysOf(settings);

  const releaseLocked = async (
    tx: Transaction,
    adminId: string,
    enrollmentId: string,
  ): Promise<EnrollmentsReleaseSlotOutput> => {
    const ids = { adminId, enrollmentId };
    const outcome = await releaseHeldSlot(tx, enrollmentId, { windowDays, clock, store });
    if (!outcome.released) {
      throw outcome.reason === 'not_found' ? notFound(log, ids) : notHeld(log, ids, outcome.reason);
    }
    log.info(
      { adminId, enrollmentId, caseId: outcome.caseId, kind: outcome.kind },
      'A held slot was released',
    );
    return { enrollmentId, slotReleasedAt: outcome.at.toISOString() };
  };

  return {
    releaseSlot: async (tx, adminId, { enrollmentId, reason, idempotencyKey }) => {
      const { outcome, replayed } = await idempotency.runOn(
        tx,
        { scope: SCOPE, key: idempotencyKey, actorId: adminId, input: { enrollmentId, reason } },
        (keyed) => releaseLocked(keyed, adminId, enrollmentId),
      );
      return { answer: outcome, replayed };
    },
  };
}
