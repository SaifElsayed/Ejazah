// T018: the teacher's packages held in memory, for the service's spec. The store keeps what the
// queries keep (a package is read and changed only beside its teacher's id), the port answers from
// enrollments planted per package, and every lock and question is logged in the order it came, so
// the spec can assert lock-then-read; the real queries are `tests/db-integrity/packages.spec.ts`'s.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { CatalogUse, PackageEnrollmentCounts } from './catalog-use.port.js';
import type {
  NewPackageRow,
  PackageChange,
  PackageRow,
  PeerPackageRow,
  PeerPackagesQuery,
} from './packages.repository.js';
import { priceForLength } from './packages.repository.js';
import type { PackagesStore, PreProgrammeRetirementStore } from './packages.service.js';

export const TEACHER = '0199d0a0-0000-7000-8000-0000000000d1';
export const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000000d2';
export const SUBJECT = {
  id: '0199d0a0-0000-7000-8000-000000000061',
  nameAr: 'القرآن الكريم',
  nameEn: "Qur'an",
};
export const OTHER_SUBJECT = {
  id: '0199d0a0-0000-7000-8000-000000000062',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};

function fail(reason: string): never {
  throw new Error(`packages fixture: ${reason}`);
}

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

type Held = PackageRow & { readonly teacherUserId: string };

/** A package as planted: either shape, without its id (006:T004). */
export type PlantedPackage = PackageRow extends infer Row
  ? Row extends PackageRow
    ? Omit<Row, 'id'>
    : never
  : never;

export class MemoryPackages implements PackagesStore, PreProgrammeRetirementStore, CatalogUse {
  /** Every lock and question, in order: `lockAccount:<id>`, `holdsSubject`, `packageOf`, … */
  readonly log: string[] = [];
  readonly #rows = new Map<string, Held>();
  readonly #subjects = new Set<string>();
  readonly #enrollments = new Map<string, PackageEnrollmentCounts>();
  readonly #published = new Set<string>();

  /** Makes the predicate show the teacher to a student of `gender`. */
  publish(teacherUserId: string, gender: 'male' | 'female'): void {
    this.#published.add(`${teacherUserId}:${gender}`);
  }

  /** Makes `subject` one of the teacher's `teacher_subjects`. */
  grant(teacherUserId: string, subject: { readonly id: string }): void {
    this.#subjects.add(`${teacherUserId}:${subject.id}`);
  }

  /** A package of the teacher, as written; its id. */
  plant(teacherUserId: string, row: PlantedPackage): string {
    const id = randomUUID();
    this.#rows.set(id, { ...row, id, teacherUserId } as Held);
    return id;
  }

  /** Enrollments on the package: `total` of any status, `active` of them confirmed. */
  enrol(packageId: string, counts: PackageEnrollmentCounts): void {
    this.#enrollments.set(packageId, counts);
  }

  /** The row as held, its teacher included; throws for an id never planted. */
  held(packageId: string): Held {
    const row = this.#rows.get(packageId);
    if (row === undefined) throw new Error(`no package ${packageId}`);
    return row;
  }

  /** Every row held. */
  all(): readonly Held[] {
    return [...this.#rows.values()];
  }

  async lockAccount(_tx: Transaction, userId: string): Promise<void> {
    this.log.push(`lockAccount:${userId}`);
  }

  async lockApplication(_tx: Transaction, userId: string): Promise<void> {
    this.log.push(`lockApplication:${userId}`);
  }

  /** 006:T004 (Q-D1 (a)): the programme switch's advisory key. */
  async lockProgrammeSwitch(_tx: Transaction): Promise<void> {
    this.log.push('lockProgrammeSwitch');
  }

  async isPublished(
    _tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
  ): Promise<boolean> {
    this.log.push(`isPublished:${requester}`);
    return this.#published.has(`${teacherUserId}:${requester}`);
  }

  async holdsSubject(_tx: Transaction, teacherUserId: string, subjectId: string): Promise<boolean> {
    this.log.push('holdsSubject');
    return this.#subjects.has(`${teacherUserId}:${subjectId}`);
  }

  async packagesOf(_tx: Transaction, teacherUserId: string): Promise<PackageRow[]> {
    this.log.push('packagesOf');
    return this.all()
      .filter((row) => row.teacherUserId === teacherUserId)
      .map(({ teacherUserId: _teacher, ...row }) => row);
  }

  async packageOf(
    _tx: Transaction,
    teacherUserId: string,
    packageId: string,
  ): Promise<PackageRow | null> {
    this.log.push('packageOf');
    const row = this.#rows.get(packageId);
    if (row === undefined || row.teacherUserId !== teacherUserId) return null;
    const { teacherUserId: _teacher, ...rest } = row;
    return rest;
  }

  async insert(_tx: Transaction, row: NewPackageRow): Promise<PackageRow> {
    this.log.push('insert');
    const subject = [SUBJECT, OTHER_SUBJECT].find(({ id }) => id === row.subjectId);
    if (subject === undefined) throw new Error(`no subject ${row.subjectId}`);
    const { subjectId: _subject, teacherUserId, ...rest } = row;
    // 006:T004: either shape, as written.
    const id = this.plant(teacherUserId, { ...rest, subject } as PlantedPackage);
    const { teacherUserId: _teacher, ...written } = this.held(id);
    return written;
  }

  async change(
    _tx: Transaction,
    teacherUserId: string,
    packageId: string,
    change: PackageChange,
  ): Promise<boolean> {
    this.log.push('change');
    const row = this.#rows.get(packageId);
    if (row === undefined || row.teacherUserId !== teacherUserId) return false;
    // 006:T004: `isProgramme` turns the package into a programme one, the old three dropped.
    const { isProgramme, prices, ...fields } = change;
    if (isProgramme === true || row.isProgramme) {
      const { id, subject, isActive, teacherUserId: teacher } = row;
      const kept = row.isProgramme ? row.prices : undefined;
      this.#rows.set(packageId, {
        id,
        subject,
        teacherUserId: teacher,
        track: 'ijazah_track',
        isProgramme: true,
        prices: prices ?? kept ?? fail('a programme package with no prices'),
        isActive: fields.isActive ?? isActive,
      });
      return true;
    }
    this.#rows.set(packageId, { ...row, ...fields } as Held);
    return true;
  }

  /** 003:T113: the other teachers' active packages on the track and length, as the query reads them. */
  async peerPackages(_tx: Transaction, query: PeerPackagesQuery): Promise<PeerPackageRow[]> {
    this.log.push('peerPackages');
    return this.all()
      .filter(
        (row) =>
          row.isActive &&
          row.track === query.track &&
          (row.isProgramme || row.sessionDurationMinutes === query.sessionDurationMinutes) &&
          row.teacherUserId !== query.viewer,
      )
      .map((row): PeerPackageRow =>
        row.isProgramme
          ? {
              teacherUserId: row.teacherUserId,
              isProgramme: true,
              sessionPrice_piasters: priceForLength(row.prices, query.sessionDurationMinutes),
            }
          : {
              teacherUserId: row.teacherUserId,
              isProgramme: false,
              price_piasters: row.price_piasters,
              sessionCount: row.sessionCount,
            },
      );
  }

  /** 003:T113: those of `teacherIds` the predicate shows a student of `requester`'s gender. */
  async visibleTeacherIds(
    _tx: Transaction,
    requester: RequesterGender,
    teacherIds: readonly string[],
  ): Promise<string[]> {
    this.log.push(`visibleTeacherIds:${requester}`);
    return teacherIds.filter((id) => this.#published.has(`${id}:${requester}`));
  }

  /** 006:T002: the teachers of every old-style ijazah package, active or not, ascending. */
  async preProgrammeIjazahOwners(_tx: Transaction): Promise<string[]> {
    this.log.push('preProgrammeIjazahOwners');
    return [
      ...new Set(
        this.all()
          .filter((row) => row.track === 'ijazah_track' && !row.isProgramme)
          .map((row) => row.teacherUserId),
      ),
    ].sort();
  }

  /** 006:T002: the accounts' locks, in one call. */
  async lockAccounts(_tx: Transaction, userIds: readonly string[]): Promise<void> {
    this.log.push(`lockAccounts:${userIds.join(',')}`);
  }

  /** 006:T002: deactivates every active old-style ijazah package; how many. */
  async deactivatePreProgrammeIjazah(_tx: Transaction): Promise<number> {
    this.log.push('deactivatePreProgrammeIjazah');
    let count = 0;
    for (const row of this.all()) {
      if (row.track === 'ijazah_track' && !row.isProgramme && row.isActive) {
        this.#rows.set(row.id, { ...row, isActive: false });
        count += 1;
      }
    }
    return count;
  }

  async slotInUse(): Promise<boolean> {
    throw new Error('no slot in the packages spec');
  }

  async packageHasEnrollment(_tx: Transaction, packageId: string): Promise<boolean> {
    this.log.push('packageHasEnrollment');
    return (this.#enrollments.get(packageId)?.total ?? 0) > 0;
  }

  async packageEnrollmentCounts(
    _tx: Transaction,
    packageIds: readonly string[],
  ): Promise<ReadonlyMap<string, PackageEnrollmentCounts>> {
    this.log.push('packageEnrollmentCounts');
    const counts = new Map<string, PackageEnrollmentCounts>();
    for (const id of packageIds) {
      const held = this.#enrollments.get(id);
      if (held !== undefined) counts.set(id, held);
    }
    return counts;
  }
}
