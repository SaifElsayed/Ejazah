// T013 of specs/005-certification: the administrators' gender-flag queue, composed in the admin
// module (FR-614, FR-615; SRS FR-GENDER-4, FR-ADMIN-8; research R-409, «Where the decisions run»;
// contracts/admin-surface.md, `genderFlags.*`; the note under T013, Q-G1 (a)). Moderation holds the
// flag rows and imports neither booking nor sessions; this module imports every entry, so the
// procedures that need another module's rows are composed here and served by this module's router.
//
// - `list`, `raise`, `dismiss`: moderation's, on the administrator kind's transaction.
// - `get`: moderation's flag, with the preview of what a correction would end now: the flagged
//   person's `confirmed` enrollments (booking's entry, `confirmedEnrollmentsOf`) whose two declared
//   genders would differ once the person's gender is the other one (identity's `sessionPartiesOf`).
//   Read with no lock: a preview, decided on again under the correction's locks (T014).
//
// The preview counts the enrollments the correction ends (FR-616: `confirmed` ones only, the note
// under T014, Q-G3 (a)); holds and closed enrollments are not in it. No line carries a gender.
import type {
  AdminGenderFlagsDismissInput,
  AdminGenderFlagsGetInput,
  AdminGenderFlagsGetOutput,
  AdminGenderFlagsListInput,
  AdminGenderFlagsListOutput,
  AdminGenderFlagsRaiseInput,
} from '@ijazah/contracts/admin';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Gender } from '../../platform/guards/requester-gender.js';
import type { Logger } from '../../platform/logging/logger.js';
import { type ConfirmedEnrollment, confirmedEnrollmentsOf } from '../booking/index.js';
import { sessionPartiesOf } from '../identity/index.js';
import type { AdminGenderFlags } from '../moderation/index.js';

/** What the decisions read with no lock, each on the call's transaction; faked in a spec. */
export interface GenderDecisionReads {
  /** The person's `confirmed` enrollments, as student or teacher, in id order (booking's). */
  confirmedEnrollmentsOf(tx: Transaction, userId: string): Promise<readonly ConfirmedEnrollment[]>;
  /** The live accounts' declared genders (identity's); a deleted account is absent. */
  gendersOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, Gender>>;
}

/** The reads over booking's and identity's entries. */
export const genderDecisionReads: GenderDecisionReads = {
  confirmedEnrollmentsOf,
  gendersOf: async (tx, userIds) =>
    new Map(
      [...(await sessionPartiesOf(tx, [...new Set(userIds)]))].map(([id, { gender }]) => [
        id,
        gender,
      ]),
    ),
};

/** The other declared gender: a correction's only outcome (FR-GENDER-4; the gender is binary). */
export function otherGender(gender: Gender): Gender {
  return gender === 'male' ? 'female' : 'male';
}

/**
 * Of `enrollments` (the person's own), the ids of those whose two declared genders differ once the
 * person's gender is `to`, in id order; an enrollment whose other party is absent is left out.
 */
export function pairingTwoGenders(
  enrollments: readonly ConfirmedEnrollment[],
  genders: ReadonlyMap<string, Gender>,
  userId: string,
  to: Gender,
): string[] {
  return enrollments
    .filter((enrollment) => {
      const other =
        enrollment.studentUserId === userId ? enrollment.teacherUserId : enrollment.studentUserId;
      const theirs = genders.get(other);
      return theirs !== undefined && theirs !== to;
    })
    .map(({ id }) => id)
    .sort();
}

export interface GenderDecisionsDependencies {
  /** Moderation's flags, the administrator's half (one `createGenderFlags` built by `main.ts`). */
  readonly flags: AdminGenderFlags;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  readonly reads?: GenderDecisionReads;
}

/** The administrator surface's `genderFlags.*`, each on the administrator kind's transaction. */
export interface GenderDecisions {
  list(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsListInput,
  ): Promise<AdminGenderFlagsListOutput>;
  get(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsGetInput,
  ): Promise<AdminGenderFlagsGetOutput>;
  raise(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsRaiseInput,
  ): Promise<{ readonly flagId: string; readonly replayed: boolean }>;
  dismiss(
    tx: Transaction,
    adminId: string,
    input: AdminGenderFlagsDismissInput,
  ): Promise<{ readonly flaggedUserId: string; readonly replayed: boolean }>;
}

export function createGenderDecisions({
  flags,
  log,
  reads = genderDecisionReads,
}: GenderDecisionsDependencies): GenderDecisions {
  /** The preview: the person's confirmed enrollments a correction would end now (this file's head). */
  const wouldEnd = async (tx: Transaction, userId: string): Promise<readonly string[]> => {
    const enrollments = await reads.confirmedEnrollmentsOf(tx, userId);
    const genders = await reads.gendersOf(tx, [
      userId,
      ...enrollments.flatMap(({ studentUserId, teacherUserId }) => [studentUserId, teacherUserId]),
    ]);
    const declared = genders.get(userId);
    if (declared === undefined) return [];
    return pairingTwoGenders(enrollments, genders, userId, otherGender(declared));
  };

  return {
    list: async (tx, adminId, input) => {
      const page = await flags.list(tx, adminId, input, log);
      return { ...page, items: [...page.items] };
    },
    get: async (tx, adminId, input) => {
      const detail = await flags.detail(tx, adminId, input, log);
      const enrollmentIds = [...(await wouldEnd(tx, detail.flaggedUserId))];
      return { ...detail, correctionWouldEnd: { count: enrollmentIds.length, enrollmentIds } };
    },
    raise: (tx, adminId, input) => flags.raiseByAdministrator(tx, adminId, input, log),
    dismiss: (tx, adminId, input) => flags.dismiss(tx, adminId, input, log),
  };
}
