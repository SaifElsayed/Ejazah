// T018: the teacher's packages held in memory, for the service's spec. The store keeps what the
// queries keep (a package is read and changed only beside its teacher's id), the port answers from
// enrollments planted per package, and every lock and question is logged in the order it came, so
// the spec can assert lock-then-read; the real queries are `tests/db-integrity/packages.spec.ts`'s.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { CatalogUse, PackageEnrollmentCounts } from './catalog-use.port.js';
import type { NewPackageRow, PackageChange, PackageRow } from './packages.repository.js';
import type { PackagesStore } from './packages.service.js';

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

/** Stands in for the call's transaction, which the memory store never reads. */
export const TX = {} as Transaction;

interface Held extends PackageRow {
  readonly teacherUserId: string;
}

export class MemoryPackages implements PackagesStore, CatalogUse {
  /** Every lock and question, in order: `lockAccount:<id>`, `holdsSubject`, `packageOf`, … */
  readonly log: string[] = [];
  readonly #rows = new Map<string, Held>();
  readonly #subjects = new Set<string>();
  readonly #enrollments = new Map<string, PackageEnrollmentCounts>();

  /** Makes `subject` one of the teacher's `teacher_subjects`. */
  grant(teacherUserId: string, subject: { readonly id: string }): void {
    this.#subjects.add(`${teacherUserId}:${subject.id}`);
  }

  /** A package of the teacher, as written; its id. */
  plant(teacherUserId: string, row: Omit<PackageRow, 'id'>): string {
    const id = randomUUID();
    this.#rows.set(id, { ...row, id, teacherUserId });
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
    const id = this.plant(teacherUserId, { ...rest, subject });
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
    this.#rows.set(packageId, { ...row, ...change });
    return true;
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
