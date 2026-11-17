// T018 (FR-311, FR-312, FR-314, FR-315, R-218; app-surface.md "`teacher.packages` — catalog"): the
// teacher's packages. The procedures admit an approved teacher, payout account verified or not,
// since drafting comes before publishing; `published` is the visibility predicate's answer for the
// teacher as a student of the session's gender would get it, asked through identity's entry
// (`isPublishedTeacher`), the same question `teacher.profile.get` asks, so the two never differ
// (FR-315, spec.md "drafting needs no published flag"; the owner's decision of 2026-11-02).
//
// - `create` writes a package on a subject that is one of the teacher's `teacher_subjects`
//   (`SUBJECT_NOT_APPROVED` otherwise, FR-311, FR-PROFILE-11 as amended), keyed through the kernel's
//   idempotency, so a retry answers the first outcome.
// - `update` changes the caller's own package only: another teacher's id answers NOT_FOUND and
//   writes nothing (PR #109's review, M3). Deactivation and reactivation are always allowed
//   (FR-314). Once the package has an enrollment, a new track or a new length is refused
//   (`PACKAGE_FROZEN`, FR-312), asked through T020's port; the same value is no change. The count,
//   the price and the state still change, and a new price reaches later purchases only, since an
//   enrollment keeps its own snapshot of the terms.
// - `list` answers each package with its price per session from `packages/money` (R-212), its
//   confirmed enrollments and whether it is frozen, asked of the port once for all of them.
// - 003:T113 (SRS DEC-88, FR-PROFILE-2 as amended; Q-T113 (a)): `averagePrice` is the editor's
//   average price per session of the other teachers' active packages on the asked track and
//   length, counting only teachers the visibility predicate shows a student of the session's gender
//   (the teacher's own), each package's `perSession` averaged half up in `packages/money`. Fewer
//   such teachers than the setting `price_average_min_teachers` (seed 3, read at each request;
//   Q-T113-k) answer nothing, so no single teacher's price is exposed; a setting outside 2 to 100
//   refuses the read. It decides nothing and takes no lock.
//
// THE LOCKS (T005's rules, the owner's decisions of 2026-11-01). Lock, then read:
// - `create` inserts a row referencing the teacher's `users` row, so it locks the account first
//   (rule 2), then the application's `teacher_profiles` row, and only then reads the subjects. A
//   revocation of the approval takes no lock of its own but moves that row before it removes the
//   subjects, so a create either commits first or waits and then reads the subjects gone; the same
//   two locks, in the same order, as a credential's approval (T142, T164).
// - `update` locks the teacher's account before it reads the package and asks whether it is
//   enrolled. An enrollment, the package's first included, is inserted only by `checkout.pay`
//   (T036), which locks the student's and the teacher's accounts in one `lockRows(tx, 'users',
//   [student, teacher])` call before it reads the package (the note under T036); the hold (T033)
//   inserts none. So an edit and a first enrollment never cross: either the edit commits first and
//   the payment reads the new terms, or the edit reads the enrollment and refuses. Packages need
//   no lock of their own (`LockedTable` has none).
// - `list` decides nothing and takes no lock.
import {
  type PackagesAveragePriceInput,
  type PackagesAveragePriceOutput,
  type PackagesCreateInput,
  type PackagesListOutput,
  type PackagesUpdateInput,
  priceAverageMinTeachers,
  type TeacherPackage,
} from '@ijazah/contracts';
import { average, perSession, piasters, toPlainNumber } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CatalogUse, PackageEnrollmentCounts } from './catalog-use.port.js';
import type {
  NewPackageRow,
  PackageChange,
  PackageRow,
  PeerPackageRow,
  PeerPackagesQuery,
} from './packages.repository.js';

/** 003:T113 (SRS DEC-88, §3.14; Q-T113-k): the fewest other teachers the average is shown over. */
export const PRICE_AVERAGE_MIN_TEACHERS_SETTING = 'price_average_min_teachers';

/** What the packages read and write, each on the transaction it is handed. */
export interface PackagesStore {
  /** Locks the account's `users` row until the transaction ends, identity's (T126). */
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  /** Locks the application's `teacher_profiles` row until the transaction ends, identity's (T126). */
  lockApplication(tx: Transaction, userId: string): Promise<void>;
  /** Whether discovery shows the teacher to a student of `requester`'s gender, identity's (FR-315). */
  isPublished(tx: Transaction, requester: RequesterGender, teacherUserId: string): Promise<boolean>;
  /** Whether the subject is one of the teacher's `teacher_subjects`. */
  holdsSubject(tx: Transaction, teacherUserId: string, subjectId: string): Promise<boolean>;
  /** The teacher's packages, oldest first. */
  packagesOf(tx: Transaction, teacherUserId: string): Promise<PackageRow[]>;
  /** The teacher's package of that id; null for an unknown id and for another teacher's. */
  packageOf(tx: Transaction, teacherUserId: string, packageId: string): Promise<PackageRow | null>;
  insert(tx: Transaction, row: NewPackageRow): Promise<PackageRow>;
  /** Changes the teacher's package; whether it did. */
  change(
    tx: Transaction,
    teacherUserId: string,
    packageId: string,
    change: PackageChange,
  ): Promise<boolean>;
  /** 003:T113: the other teachers' active packages on the track and length. */
  peerPackages(tx: Transaction, query: PeerPackagesQuery): Promise<PeerPackageRow[]>;
  /** 003:T113: those of `teacherIds` the predicate shows a student of `requester`'s gender, identity's. */
  visibleTeacherIds(
    tx: Transaction,
    requester: RequesterGender,
    teacherIds: readonly string[],
  ): Promise<string[]>;
}

export interface PackagesServiceDependencies {
  readonly transactions: Transactions;
  readonly store: PackagesStore;
  /** Booking's answers, bound by `main.ts` (T020, R-207). */
  readonly use: CatalogUse;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  /** 003:T113: `price_average_min_teachers`, read at each request. */
  readonly settings: SettingsReader;
}

const NONE: PackageEnrollmentCounts = { total: 0, active: 0 };

function answerOf(row: PackageRow, enrollments: PackageEnrollmentCounts): TeacherPackage {
  return {
    id: row.id,
    subject: row.subject,
    track: row.track,
    sessionCount: row.sessionCount,
    sessionDurationMinutes: row.sessionDurationMinutes,
    price_piasters: toPlainNumber(row.price_piasters),
    perSession_piasters: toPlainNumber(perSession(row.price_piasters, row.sessionCount)),
    isActive: row.isActive,
    activeEnrollmentCount: enrollments.active,
    frozen: enrollments.total > 0,
  };
}

/** The fields the input names, the price made piasters; the package's id left out. */
function changeOf(input: PackagesUpdateInput): PackageChange {
  return {
    ...(input.track === undefined ? {} : { track: input.track }),
    ...(input.sessionCount === undefined ? {} : { sessionCount: input.sessionCount }),
    ...(input.sessionDurationMinutes === undefined
      ? {}
      : { sessionDurationMinutes: input.sessionDurationMinutes }),
    ...(input.price_piasters === undefined
      ? {}
      : { price_piasters: piasters(input.price_piasters) }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
}

export class PackagesService {
  readonly #transactions: Transactions;
  readonly #store: PackagesStore;
  readonly #use: CatalogUse;
  readonly #idempotency: PackagesServiceDependencies['idempotency'];
  readonly #settings: SettingsReader;

  constructor({ transactions, store, use, idempotency, settings }: PackagesServiceDependencies) {
    this.#transactions = transactions;
    this.#store = store;
    this.#use = use;
    this.#idempotency = idempotency;
    this.#settings = settings;
  }

  /**
   * `teacher.packages.list`: the teacher's packages and whether they are published (FR-315);
   * `requester` is the session's gender, the teacher's own.
   */
  list(teacherUserId: string, requester: RequesterGender): Promise<PackagesListOutput> {
    return this.#transactions.run(async (tx) => {
      const published = await this.#store.isPublished(tx, requester, teacherUserId);
      const rows = await this.#store.packagesOf(tx, teacherUserId);
      const counts = await this.#use.packageEnrollmentCounts(
        tx,
        rows.map(({ id }) => id),
      );
      return {
        published,
        packages: rows.map((row) => answerOf(row, counts.get(row.id) ?? NONE)),
      };
    });
  }

  /** `teacher.packages.create`: keyed, so a retry answers the first outcome (FR-311). */
  create(teacherUserId: string, input: PackagesCreateInput): Promise<TeacherPackage> {
    const { idempotencyKey, ...terms } = input;
    return this.#idempotency.run(
      {
        scope: 'teacher.packages.create',
        key: idempotencyKey,
        actorId: teacherUserId,
        input: terms,
      },
      async (tx) => {
        await this.#store.lockAccount(tx, teacherUserId);
        await this.#store.lockApplication(tx, teacherUserId);
        if (!(await this.#store.holdsSubject(tx, teacherUserId, terms.subjectId))) {
          throw new DomainError('SUBJECT_NOT_APPROVED');
        }
        const row = await this.#store.insert(tx, {
          teacherUserId,
          subjectId: terms.subjectId,
          track: terms.track,
          sessionCount: terms.sessionCount,
          sessionDurationMinutes: terms.sessionDurationMinutes,
          price_piasters: piasters(terms.price_piasters),
          isActive: terms.isActive,
        });
        return answerOf(row, NONE);
      },
    );
  }

  /** `teacher.packages.update`: the caller's own package (FR-312, FR-314, M3). */
  update(teacherUserId: string, input: PackagesUpdateInput): Promise<TeacherPackage> {
    return this.#transactions.run(async (tx) => {
      await this.#store.lockAccount(tx, teacherUserId);
      const current = await this.#store.packageOf(tx, teacherUserId, input.packageId);
      if (current === null) throw new DomainError('NOT_FOUND');
      const change = changeOf(input);
      const newTerms =
        (change.track !== undefined && change.track !== current.track) ||
        (change.sessionDurationMinutes !== undefined &&
          change.sessionDurationMinutes !== current.sessionDurationMinutes);
      if (newTerms && (await this.#use.packageHasEnrollment(tx, current.id))) {
        throw new DomainError('PACKAGE_FROZEN');
      }
      if (Object.keys(change).length > 0) {
        // Under the account's lock the package read above is still the teacher's.
        if (!(await this.#store.change(tx, teacherUserId, current.id, change))) {
          throw new Error('packages: the package left its teacher during the edit');
        }
      }
      const changed = await this.#store.packageOf(tx, teacherUserId, current.id);
      if (changed === null) throw new Error('packages: the package disappeared during the edit');
      const counts = await this.#use.packageEnrollmentCounts(tx, [current.id]);
      return answerOf(changed, counts.get(current.id) ?? NONE);
    });
  }

  /**
   * `teacher.packages.averagePrice` (003:T113): the average price per session over at least three
   * other published teachers; `requester` is the session's gender, the teacher's own.
   */
  async averagePrice(
    teacherUserId: string,
    requester: RequesterGender,
    input: PackagesAveragePriceInput,
  ): Promise<PackagesAveragePriceOutput> {
    const minTeachers = await this.#settings.read(
      PRICE_AVERAGE_MIN_TEACHERS_SETTING,
      priceAverageMinTeachers,
    );
    return this.#transactions.run(async (tx) => {
      const pool = await this.#store.peerPackages(tx, { viewer: teacherUserId, ...input });
      const teachers = [...new Set(pool.map((row) => row.teacherUserId))];
      const shown = new Set(await this.#store.visibleTeacherIds(tx, requester, teachers));
      const counted = pool.filter((row) => shown.has(row.teacherUserId));
      if (new Set(counted.map((row) => row.teacherUserId)).size < minTeachers) {
        return {};
      }
      const [first_piasters, ...rest_piasters] = counted.map((row) =>
        perSession(row.price_piasters, row.sessionCount),
      );
      if (first_piasters === undefined) return {};
      return {
        averagePerSession_piasters: toPlainNumber(average([first_piasters, ...rest_piasters])),
      };
    });
  }
}
