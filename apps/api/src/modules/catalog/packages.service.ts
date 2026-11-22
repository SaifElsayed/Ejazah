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
//   (FR-314), but for 006:T002's (SRS DEC-110, FR-PROFILE-3 as amended): while `programme_enabled`
//   is on, an old-style ijazah-track package (`is_programme = false`) is not reactivated, CONFLICT
//   with the detail `programme_switch_on`; the switch is read after the account's lock. Once the
//   package has an enrollment, a new track or a new length is refused (`PACKAGE_FROZEN`, FR-312),
//   asked through T020's port; the same value is no change. The count,
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
// - 006:T004 (FR-704, FR-704a; R-503; Q-B2 settled, DEC-110; Q-5 (a)): a programme package takes
//   its three prices and no count, length or total (the shape check, `VALIDATION_FAILED` on a
//   field of the other shape). While `programme_enabled` is on, a new ijazah-track package, or a
//   track turned to `ijazah_track` (with its prices, the package then a programme one), is a
//   programme package only: today's shape answers CONFLICT `programme_switch_on`; while it is off,
//   no programme package is made (`programme_disabled`) and ijazah-track packages are made as
//   today. A programme package is created or made active only while the assessment's price is
//   above 0 (`assessment_fee_unset`; a draft allowed). A recitation package reads no setting. On
//   the ijazah track the average counts a programme package by its price of the asked length.
//   These settings are read after the account's lock; no lock of their own is claimed.
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
// - 006:T002 (Q-3 (a)(a)): `retirePreProgrammeIjazahPackages`, the switch's turn-on on the setting
//   change's transaction, locks the account of every teacher holding an old-style ijazah package in
//   one `lockRows(tx, 'users', …)` call, then deactivates them; a reactivation locks the same
//   account before it reads the switch, so the two never cross (`tests/db-integrity/packages.spec.ts`).
import {
  type PackagesAveragePriceInput,
  type PackagesAveragePriceOutput,
  type PackagesCreateInput,
  type PackagesListOutput,
  type PackagesUpdateInput,
  priceAverageMinTeachers,
  type ProgrammePrices,
  type ProgrammeStartRefusal,
  type SessionLengthMinutes,
  sessionLengthMinutes,
  type TeacherPackage,
} from '@ijazah/contracts';
import { average, perSession, piasters, type Piasters, toPlainNumber } from '@ijazah/money';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import { assessmentPricePiasters, programmeEnabled } from '../../platform/settings/registry.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CatalogUse, PackageEnrollmentCounts } from './catalog-use.port.js';
import type {
  FixedTerms,
  NewPackageRow,
  PackageChange,
  PackageRow,
  PeerPackageRow,
  PeerPackagesQuery,
  ProgrammePriceRow,
  ProgrammeTerms,
} from './packages.repository.js';

/** 003:T113 (SRS DEC-88, §3.14; Q-T113-k): the fewest other teachers the average is shown over. */
export const PRICE_AVERAGE_MIN_TEACHERS_SETTING = 'price_average_min_teachers';

/** 006:T002 (Q-3 (a)(a), DEC-110): what the switch's turn-on reads, locks and writes, on its transaction. */
export interface PreProgrammeRetirementStore {
  /** The teachers of every old-style ijazah-track package, active or not, ascending. */
  preProgrammeIjazahOwners(tx: Transaction): Promise<string[]>;
  /** Locks the accounts' `users` rows, in id order, in one statement. */
  lockAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** Deactivates every active old-style ijazah-track package; how many it did. */
  deactivatePreProgrammeIjazah(tx: Transaction): Promise<number>;
}

/**
 * 006:T002 (Q-3 (a)(a), DEC-110): the switch's turn-on, on the setting change's transaction. Locks
 * the account of every teacher holding an old-style ijazah package, active or not, in one call,
 * then deactivates the active ones in one update, and answers how many. A reactivation locks the
 * same account before it reads the switch (`update`), so the two never cross: a reactivation that
 * read the switch off commits first and this update then deactivates it, or it waits for this
 * transaction and reads the switch on. Turning the switch off reactivates none.
 */
export async function retirePreProgrammeIjazahPackages(
  store: PreProgrammeRetirementStore,
  tx: Transaction,
): Promise<number> {
  await store.lockAccounts(tx, await store.preProgrammeIjazahOwners(tx));
  return store.deactivatePreProgrammeIjazah(tx);
}

/** 006:T002 (SRS §3.14, DEC-94; I-3): the programme's switch, 1 on. */
export const PROGRAMME_ENABLED_SETTING = 'programme_enabled';
const PROGRAMME_ON = 1;

/** 006:T004 (SRS §3.14, DEC-93; P1 (a)): the assessment's price, whole piasters, 0 unset. */
export const ASSESSMENT_PRICE_SETTING = 'assessment_price_piasters';
/** 006:T004 (SRS §3.14, DEC-93): the assessment session's length, 30, 45 or 60 minutes. */
export const ASSESSMENT_DURATION_SETTING = 'assessment_duration_minutes';

/**
 * 006:T004 (R-503, R-515; Q-5 (a)): whether a programme package may be shown and booked now. Open
 * while `programme_enabled` is on and the assessment's price is above 0, with that price and the
 * assessment's length; closed otherwise, with the refusal a start would answer
 * (`programme_disabled`, then `assessment_fee_unset`).
 */
export type ProgrammeAvailability =
  | {
      readonly open: true;
      readonly assessmentPrice_piasters: Piasters;
      readonly assessmentDurationMinutes: SessionLengthMinutes;
    }
  | { readonly open: false; readonly refusal: ProgrammeStartRefusal };

/**
 * 006:T004 (Q-5 (a)): the programme's availability, read at each request: the switch, then the
 * assessment's price, then its length, each only when the one before it leaves the programme open.
 */
export async function programmeAvailabilityOf(
  settings: SettingsReader,
): Promise<ProgrammeAvailability> {
  if ((await settings.read(PROGRAMME_ENABLED_SETTING, programmeEnabled)) !== PROGRAMME_ON) {
    return { open: false, refusal: 'programme_disabled' };
  }
  const fee = await settings.read(ASSESSMENT_PRICE_SETTING, assessmentPricePiasters);
  if (fee === 0) return { open: false, refusal: 'assessment_fee_unset' };
  return {
    open: true,
    assessmentPrice_piasters: piasters(fee),
    assessmentDurationMinutes: await settings.read(
      ASSESSMENT_DURATION_SETTING,
      sessionLengthMinutes,
    ),
  };
}

/** 006:T002 (DEC-110): whether the change turns an inactive old-style ijazah package active. */
function reactivatesPreProgrammeIjazah(current: PackageRow, change: PackageChange): boolean {
  return (
    change.isActive === true &&
    !current.isActive &&
    current.track === 'ijazah_track' &&
    !current.isProgramme
  );
}

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

/** 006:T004: a programme package's three prices as the contract carries them, plain piasters. */
export function plainPrices(prices: ProgrammePriceRow): ProgrammePrices {
  return {
    m30_piasters: toPlainNumber(prices.m30_piasters),
    m45_piasters: toPlainNumber(prices.m45_piasters),
    m60_piasters: toPlainNumber(prices.m60_piasters),
  };
}

/** 006:T004: the contract's three prices made piasters (R-MONEY-1). */
function pricesOfInput(prices: ProgrammePrices): ProgrammePriceRow {
  return {
    m30_piasters: piasters(prices.m30_piasters),
    m45_piasters: piasters(prices.m45_piasters),
    m60_piasters: piasters(prices.m60_piasters),
  };
}

function answerOf(row: PackageRow, enrollments: PackageEnrollmentCounts): TeacherPackage {
  const held = {
    isActive: row.isActive,
    activeEnrollmentCount: enrollments.active,
    frozen: enrollments.total > 0,
  };
  if (row.isProgramme) {
    // 006:T004 (R-503, K-3): the contract's programme member.
    return {
      id: row.id,
      subject: row.subject,
      track: row.track,
      isProgramme: true,
      prices: plainPrices(row.prices),
      ...held,
    };
  }
  return {
    id: row.id,
    subject: row.subject,
    track: row.track,
    sessionCount: row.sessionCount,
    sessionDurationMinutes: row.sessionDurationMinutes,
    price_piasters: toPlainNumber(row.price_piasters),
    perSession_piasters: toPlainNumber(perSession(row.price_piasters, row.sessionCount)),
    ...held,
  };
}

/** A package's session length; a programme package has none until its offer (006:T004, R-506). */
function lengthOf(row: PackageRow): SessionLengthMinutes | undefined {
  return row.isProgramme ? undefined : row.sessionDurationMinutes;
}

/** A shape the contract's `hasOneShape` refuses, reached here by a caller that skipped it. */
function shapeRefused(path: string): never {
  throw new DomainError('VALIDATION_FAILED', undefined, { details: [{ path, code: 'custom' }] });
}

/**
 * 006:T004 (R-503; data-model.md «packages»): the new package's terms by shape: its three prices on
 * `ijazah_track`, or its count, length and price.
 */
function termsOfInput(
  terms: Omit<PackagesCreateInput, 'idempotencyKey'>,
): FixedTerms | ProgrammeTerms {
  if (terms.prices !== undefined) {
    if (terms.track !== 'ijazah_track') return shapeRefused('prices');
    return { track: terms.track, isProgramme: true, prices: pricesOfInput(terms.prices) };
  }
  const { sessionCount, sessionDurationMinutes, price_piasters } = terms;
  if (sessionCount === undefined) return shapeRefused('sessionCount');
  if (sessionDurationMinutes === undefined) return shapeRefused('sessionDurationMinutes');
  if (price_piasters === undefined) return shapeRefused('price_piasters');
  return {
    track: terms.track,
    isProgramme: false,
    sessionCount,
    sessionDurationMinutes,
    price_piasters: piasters(price_piasters),
  };
}

/** The fields the input names, the prices made piasters; the package's id left out. */
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
    ...(input.prices === undefined ? {} : { prices: pricesOfInput(input.prices) }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
}

/** The fields of today's shape a change may name (006:T004). */
const FIXED_FIELDS = ['sessionCount', 'sessionDurationMinutes', 'price_piasters'] as const;

/**
 * 006:T004 (R-503; data-model.md «packages», ERD section 15 rule 73): the input's change checked
 * against the package's shape. A programme package takes its prices and its state, never a count, a
 * length, a total or another track. A package with a count takes three prices only with its track
 * turned to `ijazah_track` in the same edit, and none of today's three beside them: it then becomes a
 * programme package (`isProgramme`), today's three NULL.
 */
function shapedChangeOf(current: PackageRow, input: PackagesUpdateInput): PackageChange {
  const change = changeOf(input);
  const fixedField = FIXED_FIELDS.find((field) => input[field] !== undefined);
  if (current.isProgramme) {
    if (fixedField !== undefined) return shapeRefused(fixedField);
    if (input.track !== undefined && input.track !== 'ijazah_track') return shapeRefused('track');
    return change;
  }
  if (input.prices === undefined) return change;
  if (input.track !== 'ijazah_track' || current.track === 'ijazah_track') {
    return shapeRefused('prices');
  }
  if (fixedField !== undefined) return shapeRefused(fixedField);
  return { ...change, isProgramme: true };
}

/** 006:T004: a refusal by the programme's switch or the assessment's price, a 409 with its code. */
function programmeRefused(
  path: string,
  code: ProgrammeStartRefusal | 'programme_switch_on',
): never {
  throw new DomainError('CONFLICT', undefined, { details: [{ path, code }] });
}

/**
 * 003:T113 (DEC-88): a pool package's price per session; 006:T004 (DEC-88 as amended, FR-704a): a
 * programme package's price for the length, already per session.
 */
function sessionPriceOf(row: PeerPackageRow): Piasters {
  return row.isProgramme
    ? row.sessionPrice_piasters
    : perSession(row.price_piasters, row.sessionCount);
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
        const shaped = termsOfInput(terms);
        await this.#refuseNewByProgramme(shaped, terms.isActive);
        const row = await this.#store.insert(tx, {
          teacherUserId,
          subjectId: terms.subjectId,
          isActive: terms.isActive,
          ...shaped,
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
      const change = shapedChangeOf(current, input);
      // 006:T002 (DEC-110): read after the account's lock, which the switch's turn-on takes too;
      // 006:T004 reads it once for its own rules beside.
      let switchRead: Promise<boolean> | undefined;
      const switchOn = (): Promise<boolean> => (switchRead ??= this.#switchOn());
      if (reactivatesPreProgrammeIjazah(current, change) && (await switchOn())) {
        programmeRefused('isActive', 'programme_switch_on');
      }
      await this.#refuseChangeByProgramme(current, change, switchOn);
      const newTerms =
        (change.track !== undefined && change.track !== current.track) ||
        (change.sessionDurationMinutes !== undefined &&
          change.sessionDurationMinutes !== lengthOf(current));
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

  /** 006:T004: whether `programme_enabled` is on, read at the request. */
  async #switchOn(): Promise<boolean> {
    return (
      (await this.#settings.read(PROGRAMME_ENABLED_SETTING, programmeEnabled)) === PROGRAMME_ON
    );
  }

  /** 006:T004 (Q-5 (a)): whether the assessment's price is set, above 0. */
  async #feeSet(): Promise<boolean> {
    return (await this.#settings.read(ASSESSMENT_PRICE_SETTING, assessmentPricePiasters)) > 0;
  }

  /**
   * 006:T004 (Q-B2 settled, DEC-110; Q-5 (a)): a new ijazah-track package under the switch. On, it is
   * a programme package only (`programme_switch_on` for today's shape); off, a programme package is
   * refused (`programme_disabled`). An active programme package needs the assessment's price set
   * (`assessment_fee_unset`); a draft does not. A recitation package reads nothing.
   */
  async #refuseNewByProgramme(
    terms: FixedTerms | ProgrammeTerms,
    isActive: boolean,
  ): Promise<void> {
    if (terms.track !== 'ijazah_track') return;
    const on = await this.#switchOn();
    if (!terms.isProgramme) {
      if (on) programmeRefused('track', 'programme_switch_on');
      return;
    }
    if (!on) programmeRefused('prices', 'programme_disabled');
    if (isActive && !(await this.#feeSet())) programmeRefused('isActive', 'assessment_fee_unset');
  }

  /**
   * 006:T004 (Q-B2 settled, DEC-110; Q-5 (a)): an edit under the switch. A track turned to
   * `ijazah_track` gives a programme package only while the switch is on (`programme_switch_on`
   * without prices) and none while it is off (`programme_disabled` with them). A programme package
   * that becomes active, by its state or by the turn, needs the assessment's price set
   * (`assessment_fee_unset`); one already active, or kept a draft, does not.
   */
  async #refuseChangeByProgramme(
    current: PackageRow,
    change: PackageChange,
    switchOn: () => Promise<boolean>,
  ): Promise<void> {
    const turned = change.track === 'ijazah_track' && current.track !== 'ijazah_track';
    if (turned && change.isProgramme === undefined && (await switchOn())) {
      programmeRefused('track', 'programme_switch_on');
    }
    if (change.isProgramme === true && !(await switchOn())) {
      programmeRefused('prices', 'programme_disabled');
    }
    const programme = current.isProgramme || change.isProgramme === true;
    const activated =
      (change.isActive ?? current.isActive) && !(current.isProgramme && current.isActive);
    if (programme && activated && !(await this.#feeSet())) {
      programmeRefused('isActive', 'assessment_fee_unset');
    }
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
      const [first_piasters, ...rest_piasters] = counted.map(sessionPriceOf);
      if (first_piasters === undefined) return {};
      return {
        averagePerSession_piasters: toPlainNumber(average([first_piasters, ...rest_piasters])),
      };
    });
  }
}
