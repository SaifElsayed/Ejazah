// T049: the signed-in person's own account (FR-131, FR-132, FR-137; app-surface.md "`account`").
//
// `me` answers the caller's own account and nothing of another person: the fields
// contracts/app-surface.md names, the photo as a signed link that lapses after
// `document_link_ttl_seconds` (never the storage key), and for a teacher the application and payout
// standing of the identity module's own `teacher_profiles` row. Before the application exists the
// teacher reads as `not_started`, verification `pending`, payout unset. No count over another
// module's table is taken: the credentials badge reads `teacher.credentials.list` (T049's text).
//
// The time zone is the device's until the person chooses one by hand (FR-AUTH-10): `setTimezone`
// stamps `timezone_overridden_at`, and `reportDeviceTimezone`, called on every launch, writes only
// while that is null. Both check the zone against the time package first, as onboarding does.
import { assertTimeZone, calendarDateOf, TimeError } from '@ijazah/time';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SignInMethod } from './identity.repository.js';
import { landingFor } from './session.service.js';
import { type OwnAccountRow, UsersRepository } from './users.repository.js';

export interface AccountDependencies {
  readonly database: Pick<Database, 'user'>;
  readonly settings: SettingsReader;
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly now?: () => Date;
}

/** `account.me`'s answer (packages/contracts, `meOutput`). */
export interface OwnAccount {
  readonly userId: string;
  readonly role: 'student' | 'teacher';
  readonly displayName: string;
  readonly email: string | null;
  readonly gender: 'male' | 'female';
  readonly dateOfBirth: string;
  readonly preferredLanguage: 'ar' | 'en';
  readonly timezone: string;
  readonly signInMethod: SignInMethod;
  readonly memberSince: string;
  readonly accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned';
  readonly landing: 'student_home' | 'teacher_application' | 'teacher_home' | 'restricted';
  readonly photoUrl?: string;
  readonly teacher?: {
    readonly applicationStatus:
      'not_started' | 'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
    readonly payout: {
      readonly configured: boolean;
      readonly verified: boolean;
      readonly rejectedReason?: string;
    };
  };
}

const unknownZone = () =>
  new DomainError('VALIDATION_FAILED', undefined, {
    details: [{ path: 'timezone', code: 'unknown' }],
  });

function checkedZone(timezone: string): string {
  try {
    return assertTimeZone('timezone', timezone);
  } catch (error: unknown) {
    if (error instanceof TimeError) throw unknownZone();
    throw error;
  }
}

/** How an account signs in: its password, or the provider of its identity (FR-123). */
function signInMethodOf(row: OwnAccountRow): SignInMethod {
  return row.passwordHash === null ? (row.providers[0] ?? 'email') : 'email';
}

function teacherOf(row: OwnAccountRow): NonNullable<OwnAccount['teacher']> {
  const profile = row.profile;
  return {
    applicationStatus: profile?.applicationStatus ?? 'not_started',
    verificationStatus: profile?.verificationStatus ?? 'pending',
    payout: {
      configured: profile?.payoutConfiguredAt != null,
      verified: profile?.payoutVerifiedAt != null,
      ...(profile?.payoutRejectedReason == null
        ? {}
        : { rejectedReason: profile.payoutRejectedReason }),
    },
  };
}

export class AccountService {
  readonly #users: UsersRepository;
  readonly #dependencies: AccountDependencies;
  readonly #now: () => Date;

  constructor(dependencies: AccountDependencies) {
    this.#dependencies = dependencies;
    this.#users = new UsersRepository(dependencies.database);
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** The caller's own account (FR-131); refused once the account no longer exists. */
  async me(userId: string): Promise<OwnAccount> {
    const row = await this.#users.readOwn(userId);
    if (row === null || row.role === undefined || row.dateOfBirth === null) {
      throw new DomainError('UNAUTHENTICATED');
    }
    const photoUrl = await this.#photoUrl(row.photoKey);
    const teacher = row.role === 'teacher' ? teacherOf(row) : undefined;
    return {
      userId: row.id,
      role: row.role,
      displayName: row.displayName ?? '',
      email: row.email,
      gender: row.gender,
      dateOfBirth: calendarDateOf(row.dateOfBirth),
      preferredLanguage: row.preferredLanguage,
      timezone: row.timezone,
      signInMethod: signInMethodOf(row),
      memberSince: row.createdAt.toISOString(),
      accountStatus: row.accountStatus,
      landing: landingFor({
        role: row.role,
        accountStatus: row.accountStatus,
        ...(teacher === undefined ? {} : { teacher }),
      }),
      ...(photoUrl === undefined ? {} : { photoUrl }),
      ...(teacher === undefined ? {} : { teacher }),
    };
  }

  /** The display name; nothing changes when none is given. */
  async updateProfile(userId: string, input: { readonly displayName?: string | undefined }) {
    if (input.displayName === undefined) return;
    await this.#users.setDisplayName(userId, input.displayName);
  }

  /** The account's language, switched without sign-out (FR-131, FR-LOC-3). */
  async setLanguage(userId: string, language: 'ar' | 'en'): Promise<void> {
    await this.#users.setLanguage(userId, language);
  }

  /** The zone chosen by hand; kept from now on (FR-AUTH-10). */
  async setTimezone(userId: string, timezone: string): Promise<void> {
    await this.#users.overrideTimezone(userId, checkedZone(timezone), this.#now());
  }

  /** The device's zone, reported on launch; ignored once a zone was chosen by hand. */
  async reportDeviceTimezone(userId: string, timezone: string): Promise<void> {
    await this.#users.reportDeviceTimezone(userId, checkedZone(timezone));
  }

  async #photoUrl(photoKey: string | null): Promise<string | undefined> {
    if (photoKey === null) return undefined;
    const seconds = await this.#dependencies.settings.read(
      DOCUMENT_LINK_TTL_SETTING,
      z.int().positive(),
    );
    return this.#dependencies.storage.temporaryLink(photoKey, seconds);
  }
}
