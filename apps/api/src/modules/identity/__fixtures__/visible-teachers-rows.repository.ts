// T010: the people the visibility predicate's specs write, on the transaction the spec rolls back,
// and nothing a request ever runs. Only an identity repository may reach the identity tables
// (R-API-6), so the specs reach `users` and `teacher_profiles` through this one, as
// `rows.repository.ts` does for the services' specs. Each answers an id, never a row.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../../../platform/db/prisma.repository.js';

type Client = Pick<Transaction, 'user' | 'teacherProfile'>;

export type SpecGender = 'male' | 'female';
export type SpecAccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';
export type SpecVerificationStatus =
  'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';

/** A person, live and active unless said. */
export interface SpecPerson {
  readonly gender: SpecGender;
  readonly accountStatus?: SpecAccountStatus;
  readonly displayName?: string;
  /** Soft-deleted (`deleted_at` set), the row otherwise kept. */
  readonly deleted?: boolean;
}

/** A teacher, visible to a requester of the same gender unless a field says otherwise. */
export interface SpecTeacher extends SpecPerson {
  readonly verificationStatus?: SpecVerificationStatus;
  readonly payoutVerified?: boolean;
  /** `numeric(3,2)` as text; null for a teacher with no review. */
  readonly averageRating?: string | null;
  readonly reviewCount?: number;
}

/** Writes a person straight to `users`; the id. */
export async function createPerson(tx: Client, person: SpecPerson): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `spec-${randomUUID()}@example.invalid`,
      gender: person.gender,
      dateOfBirth: new Date('1990-04-12'),
      displayName: person.displayName ?? 'Spec Person',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: person.accountStatus ?? 'active',
      deletedAt: person.deleted === true ? new Date('2026-10-30T09:00:00Z') : null,
    },
    select: { id: true },
  });
  return id;
}

/** Writes a teacher, the person and the profile; the id of the person. */
export async function createTeacher(tx: Client, teacher: SpecTeacher): Promise<string> {
  const userId = await createPerson(tx, teacher);
  await tx.teacherProfile.create({
    data: {
      userId,
      bio: 'Spec bio',
      qualificationSummary: 'Spec qualification',
      verificationStatus: teacher.verificationStatus ?? 'approved',
      payoutVerifiedAt: teacher.payoutVerified === false ? null : new Date('2026-10-20T09:00:00Z'),
      averageRating: teacher.averageRating ?? null,
      reviewCount: teacher.reviewCount ?? 0,
    },
    select: { id: true },
  });
  return userId;
}
