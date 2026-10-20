// B9 (T042–T045): what the identity services' specs share, and nothing a request ever runs. The
// specs run over the real database (stage 2 of the pipeline carries a migrated Postgres, as
// `quickstart` does locally) and the stand-ins of the ports, on a clock of their own; the settings
// are the seeded values of data-model §4, read through a fake reader, so a spec never depends on the
// seed. Every person a spec creates carries a fresh address and subject, so specs running together
// never meet, and `rowsNaming` sweeps every table of the schema for a value, to prove that an
// abandoned flow left nothing behind (FR-125, SC-103).
import { randomBytes, randomUUID } from 'node:crypto';

import { addSeconds } from '@ijazah/time';
import { config as readDotenv } from 'dotenv';
import pg from 'pg';
import { z } from 'zod';

import { openDatabase, type Database } from '../../platform/db/prisma.repository.js';
import type { EmailPort, Mail } from '../../platform/ports/email/email.port.js';
import {
  type AuthorizationExchange,
  IdentityTokenError,
  type IdentityTokenRequest,
  type ProviderGrant,
  type ProviderIdentity,
  type SignInPort,
  type SignInProvider,
} from '../../platform/ports/sign-in/sign-in.port.js';
import { MemorySingleUseMarks } from '../../platform/redis/single-use-marks.fixtures.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import { EmailAuthService, type PasswordHashing } from './email-auth.service.js';
import { OnboardingService } from './onboarding.service.js';
import { type CodeHasher, OneTimeCodes } from './one-time-codes.js';
import { SessionService } from './session.service.js';
import { SignInService } from './sign-in.service.js';

/** The seeded values the services read (prisma/seed.ts, data-model §4). */
export const SEEDED_SETTINGS: Readonly<Record<string, unknown>> = {
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  terms_version: '2026-10',
};

/** A settings reader over `values`, failing closed as the real one does. */
export function settingsOf(values: Readonly<Record<string, unknown>>): SettingsReader {
  return {
    async read<T>(key: string, schema: z.ZodType<T>): Promise<T> {
      if (!Object.hasOwn(values, key)) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(values[key]);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

/** A key of the configuration's shape: 32 random bytes, base64. */
export const SPEC_ENCRYPTION_KEY = randomBytes(32).toString('base64');

function databaseUrl(): string {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  const url = process.env['DATABASE_URL'] ?? fromDotenv['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('identity specs: DATABASE_URL is not set (quickstart §1)');
  }
  return url;
}

/** The application role's client, as the API opens it. */
export function openSpecDatabase(): Database {
  return openDatabase(databaseUrl(), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
}

/** A clock the spec moves. */
export class SpecClock {
  #now: Date;

  constructor(start = new Date('2026-10-20T08:00:00Z')) {
    this.#now = start;
  }

  readonly now = (): Date => this.#now;

  advance(seconds: number): void {
    this.#now = new Date(addSeconds(this.#now, seconds));
  }
}

/** A fresh address no other spec uses. */
export function uniqueEmail(): string {
  return `spec-${randomUUID()}@example.com`;
}

/** A fresh provider subject (letters, digits and `-`, as the stand-in's shape requires). */
export function uniqueSubject(): string {
  return `sub-${randomUUID()}`;
}

// The ports' stand-ins live in their folders, and a module may name no adapter (R-API-4), so the
// specs run over these two, as the upload specs run over theirs (T024, surfaces/upload-fixtures.ts).
// The sign-in fake reads the stand-in's documented shape (platform/ports/sign-in/fake.adapter.ts):
// `fake.<provider>.<subject>.<email or ->.<verified|unverified>.<nonce>`.

/** One call a spec port received. */
export interface SpecCall {
  readonly operation: 'verifyIdentityToken' | 'exchangeAuthorization' | 'revoke';
  readonly args: readonly unknown[];
}

/** A token of the stand-in's shape. */
export function specIdentityToken({
  provider,
  subject,
  email,
  emailVerified,
  nonce,
}: {
  readonly provider: SignInProvider;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly nonce: string;
}): string {
  return [
    'fake',
    provider,
    subject,
    email ?? '-',
    emailVerified ? 'verified' : 'unverified',
    nonce,
  ].join('.');
}

/** The sign-in port over the stand-in's token shape, recording every call. */
export class SpecSignInPort implements SignInPort {
  readonly calls: SpecCall[] = [];

  async verifyIdentityToken(request: IdentityTokenRequest): Promise<ProviderIdentity> {
    this.calls.push({ operation: 'verifyIdentityToken', args: [request] });
    const segments = request.token.split('.');
    const [prefix, provider, subject] = segments;
    const flag = segments.at(-2);
    const email = segments.slice(3, -2).join('.');
    if (prefix !== 'fake' || segments.length < 6 || subject === undefined || subject === '') {
      throw new IdentityTokenError('shape');
    }
    if (provider !== request.provider) throw new IdentityTokenError('issuer');
    if (segments.at(-1) !== request.nonce) throw new IdentityTokenError('nonce');
    return {
      provider: request.provider,
      subject,
      email: email === '-' ? null : email,
      emailVerified: flag === 'verified' && email !== '-',
      displayName: null,
    };
  }

  async exchangeAuthorization(
    exchange: AuthorizationExchange,
  ): Promise<{ readonly refreshToken: string }> {
    this.calls.push({ operation: 'exchangeAuthorization', args: [exchange] });
    return { refreshToken: `fake-refresh.${exchange.provider}.${exchange.code}` };
  }

  async revoke(grant: ProviderGrant): Promise<void> {
    this.calls.push({ operation: 'revoke', args: [grant] });
  }
}

/** The email port, keeping every mail it was handed. */
export class SpecEmail implements EmailPort {
  readonly mails: Mail[] = [];

  async deliver(mail: Mail): Promise<void> {
    this.mails.push(mail);
  }
}

/** The six-digit code the last mail to `to` carried. */
export function codeMailedTo(mails: readonly Mail[], to: string): string {
  const mail = [...mails].reverse().find((each) => each.to === to);
  const code = mail?.text.match(/\b\d{6}\b/)?.[0];
  if (code === undefined) throw new Error(`no code was mailed to ${to}`);
  return code;
}

/** Every service of the identity module, over the spec's database, stand-ins and clock. */
export function buildIdentity(
  database: Database,
  overrides: Partial<{
    readonly settings: Readonly<Record<string, unknown>>;
    /** The password hashing the services use; spied on to prove a decoy branch does the work. */
    readonly passwords: PasswordHashing;
    /** The code hashing, the same way. */
    readonly codeHasher: CodeHasher;
    /** The mail port; the recording stand-in unless a spec needs one that hangs or fails. */
    readonly email: EmailPort;
  }> = {},
) {
  const clock = new SpecClock();
  const settings = settingsOf({ ...SEEDED_SETTINGS, ...overrides.settings });
  const marks = new MemorySingleUseMarks(clock.now);
  const recorder = new SpecEmail();
  const email = overrides.email ?? recorder;
  const signInPort = new SpecSignInPort();
  const warnings: unknown[] = [];
  const log = { warn: (entry: unknown) => void warnings.push(entry) };
  const base = { database, settings, encryptionKey: SPEC_ENCRYPTION_KEY, now: clock.now };
  const sessions = new SessionService(base);
  const codes = new OneTimeCodes({
    ...base,
    email,
    log,
    ...(overrides.codeHasher === undefined ? {} : { hasher: overrides.codeHasher }),
  });
  const onboarding = new OnboardingService({ ...base, marks, sessions, codes });
  const signIn = new SignInService({ ...base, marks, signIn: signInPort, onboarding, sessions });
  const emailAuth = new EmailAuthService({
    ...base,
    codes,
    onboarding,
    sessions,
    ...(overrides.passwords === undefined ? {} : { passwords: overrides.passwords }),
  });
  const mails = () => recorder.mails;
  return {
    clock,
    settings,
    marks,
    email: recorder,
    signInPort,
    warnings,
    sessions,
    codes,
    onboarding,
    signIn,
    emailAuth,
    mails,
  };
}

export type Identity = ReturnType<typeof buildIdentity>;

/** Writes an account straight to its tables, as `onboarding.complete` would have. */
export async function createAccount(
  database: Database,
  {
    email = uniqueEmail(),
    role = 'student',
    gender = 'female',
    accountStatus = 'active',
    passwordHash = null,
    provider,
  }: {
    readonly email?: string;
    readonly role?: 'student' | 'teacher';
    readonly gender?: 'male' | 'female';
    readonly accountStatus?: 'active' | 'suspended' | 'verification_required' | 'banned';
    readonly passwordHash?: string | null;
    readonly provider?: { readonly provider: 'google' | 'apple'; readonly subject: string };
  } = {},
): Promise<{ readonly userId: string; readonly email: string }> {
  const user = await database.user.create({
    data: {
      email,
      passwordHash,
      gender,
      dateOfBirth: new Date('1990-04-12'),
      displayName: 'Spec Person',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus,
    },
    select: { id: true },
  });
  await database.userRole.create({ data: { userId: user.id, role, status: 'active' } });
  if (provider !== undefined) {
    await database.authIdentity.create({
      data: { userId: user.id, provider: provider.provider, providerSubject: provider.subject },
    });
  }
  return { userId: user.id, email };
}

/** A teacher's profile at a given standing. */
export async function createTeacherProfile(
  database: Database,
  userId: string,
  standing: {
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
    readonly applicationStatus: 'in_review' | 'needs_document' | 'rejected' | 'banned' | 'approved';
    readonly payoutVerifiedAt?: Date | null;
  },
): Promise<void> {
  await database.teacherProfile.create({
    data: {
      userId,
      bio: '',
      qualificationSummary: '',
      verificationStatus: standing.verificationStatus,
      applicationStatus: standing.applicationStatus,
      payoutVerifiedAt: standing.payoutVerifiedAt ?? null,
    },
  });
}

/**
 * Every (table, column) of the schema holding a row whose text is one of `values`: a sweep of the
 * whole schema, so a table no spec thought of cannot hide a row (FR-125's "an abandoned flow leaves
 * no row"). Text, `citext`, `varchar` and `uuid` columns are read; a value is compared whole.
 */
export async function rowsNaming(values: readonly string[]): Promise<string[]> {
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    const { rows: columns } = await db.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.udt_name IN ('text', 'citext', 'varchar', 'uuid')`,
    );
    const found: string[] = [];
    for (const { table_name: table, column_name: column } of columns) {
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${pg.escapeIdentifier(table)}
          WHERE ${pg.escapeIdentifier(column)}::text = ANY($1::text[])`,
        [values],
      );
      if (rows[0] !== undefined && rows[0].n !== '0') found.push(`${table}.${column}`);
    }
    return found;
  } finally {
    await db.end();
  }
}
