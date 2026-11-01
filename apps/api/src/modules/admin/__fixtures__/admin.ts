// B12a (T060, T061, T066): what the admin services' specs share, and nothing a request ever runs. As
// the identity specs do, they run over the real database (stage 2 of the pipeline carries a migrated
// Postgres, as `quickstart` does locally), on a clock of their own, with the seeded settings of
// data-model §4 read through a fake reader. Every administrator a spec creates carries a fresh
// address, so specs running together never meet.
import { randomBytes, randomUUID } from 'node:crypto';

import { addSeconds } from '@ijazah/time';
import { config as readDotenv } from 'dotenv';
import type { z } from 'zod';

import {
  ColumnCipher,
  columnKeyId,
  createColumnCipher,
} from '../../../platform/crypto/encryption.js';
import { hashPassword } from '../../../platform/crypto/hashing.js';
import { generateTotpSecret, totpCode } from '../../../platform/crypto/totp.js';
import { openDatabase, type Database, type Transaction } from '../../../platform/db/prisma.repository.js';
import type { EmailPort, Mail } from '../../../platform/ports/email/email.port.js';
import { MemorySingleUseMarks } from '../../../platform/redis/single-use-marks.fixtures.js';
import { SettingError, type SettingsReader } from '../../../platform/settings/settings-reader.js';
import { AdminAuthService, type PasswordHashing } from '../admin-auth.service.js';
import { AdminInvites } from '../admin-invite.js';
import { AdminSessionService } from '../admin-session.service.js';
import { MFA_SECRET_COLUMN } from '../admin-users.repository.js';
import { AdminsService } from '../admins.service.js';
import { SpecAdminRows } from './rows.repository.js';

/** The seeded values the services read (prisma/seed.ts, data-model §4). */
export const SEEDED_ADMIN_SETTINGS: Readonly<Record<string, unknown>> = {
  admin_lockout_attempts: 5,
  admin_lockout_minutes: 15,
  admin_session_idle_minutes: 60,
  admin_session_max_hours: 12,
  admin_invite_ttl_hours: 48,
  admin_recovery_code_count: 10,
  admin_list_page_size: 25,
  admin_home_latest_actions: 7,
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

/**
 * The key a rotation moves to, SPEC_ENCRYPTION_KEY then being the previous one (T134): drawn until
 * its key id differs, as the cipher refuses two keys sharing one.
 */
export const ROTATED_ENCRYPTION_KEY = keyBeside(SPEC_ENCRYPTION_KEY);

function keyBeside(previous: string): string {
  for (;;) {
    const key = randomBytes(32).toString('base64');
    if (columnKeyId(key) !== columnKeyId(previous)) return key;
  }
}

export const SPEC_PANEL_ORIGIN = 'https://admin.ijazah.test';

/** The application role's client, as the API opens it. */
export function openSpecDatabase(): Database {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  const url = process.env['DATABASE_URL'] ?? fromDotenv['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('admin specs: DATABASE_URL is not set (quickstart §1)');
  }
  return openDatabase(url, { poolMax: 4, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 30_000 });
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

/** The mail port, recording every mail. */
export class SpecEmail implements EmailPort {
  readonly mails: Mail[] = [];

  async deliver(mail: Mail): Promise<void> {
    this.mails.push(mail);
  }
}

/** A fresh address no other spec uses. */
export function uniqueEmail(): string {
  return `admin-${randomUUID()}@example.com`;
}

export const SPEC_PASSWORD = 'correct horse battery staple';

/** An administrator a spec signs in as: the row's id, the address, the password and the TOTP secret. */
export interface SpecAdmin {
  readonly adminId: string;
  readonly email: string;
  readonly password: string;
  readonly secret: string;
}

export function buildAdmin(
  database: Database,
  overrides: Partial<{
    readonly settings: Readonly<Record<string, unknown>>;
    /** The password hashing the sign-in uses; replaced to prove a refusal does the same work. */
    readonly passwords: PasswordHashing;
    /**
     * After a rotation (T134): the services run under ROTATED_ENCRYPTION_KEY with SPEC_ENCRYPTION_KEY
     * the previous one, while `createAdministrator` still writes under the spec key, as before it.
     */
    readonly rotated: boolean;
  }> = {},
) {
  const clock = new SpecClock();
  const settings = settingsOf({ ...SEEDED_ADMIN_SETTINGS, ...overrides.settings });
  const rotated = overrides.rotated === true;
  const encryptionKey = rotated ? ROTATED_ENCRYPTION_KEY : SPEC_ENCRYPTION_KEY;
  const base = { database, settings, encryptionKey, now: clock.now };
  const cipher = new ColumnCipher(SPEC_ENCRYPTION_KEY);
  // What the services hold: the process's cipher, reading under the previous key too once rotated.
  const serviceCipher = createColumnCipher({
    ENCRYPTION_KEY: encryptionKey,
    ...(rotated ? { ENCRYPTION_KEY_PREVIOUS: SPEC_ENCRYPTION_KEY } : {}),
  });
  const rows = new SpecAdminRows(database);
  const sessions = new AdminSessionService(base);
  const queued: string[] = [];
  const invites = new AdminInvites({ ...base, panelOrigin: SPEC_PANEL_ORIGIN });
  const email = new SpecEmail();
  const marks = new MemorySingleUseMarks(clock.now);

  /** Writes an administrator; by default enrolled, with a password set, and a known secret. */
  async function createAdministrator(
    options: Partial<{
      readonly enrolled: boolean;
      readonly isActive: boolean;
      readonly password: string | null;
      readonly failedSignInCount: number;
      readonly lockedUntilAt: Date | null;
      readonly invitedAt: Date | null;
      readonly passwordSetAt: Date | null;
      readonly invitedByAdminId: string | null;
      readonly email: string;
      readonly displayName: string;
    }> = {},
  ): Promise<SpecAdmin> {
    const adminId = randomUUID();
    const address = options.email ?? uniqueEmail();
    const secret = generateTotpSecret();
    const password = options.password === undefined ? SPEC_PASSWORD : options.password;
    await rows.createAdministrator({
      id: adminId,
      email: address,
      passwordHash: password === null ? null : await hashPassword(password),
      mfaSecretEncrypted: cipher.encrypt(secret, MFA_SECRET_COLUMN, adminId),
      now: clock.now(),
      ...(options.enrolled === undefined ? {} : { enrolled: options.enrolled }),
      ...(options.isActive === undefined ? {} : { isActive: options.isActive }),
      ...(options.failedSignInCount === undefined
        ? {}
        : { failedSignInCount: options.failedSignInCount }),
      ...(options.lockedUntilAt === undefined ? {} : { lockedUntilAt: options.lockedUntilAt }),
      ...(options.invitedAt === undefined ? {} : { invitedAt: options.invitedAt }),
      ...(options.passwordSetAt === undefined ? {} : { passwordSetAt: options.passwordSetAt }),
      ...(options.invitedByAdminId === undefined
        ? {}
        : { invitedByAdminId: options.invitedByAdminId }),
      ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
    });
    return { adminId, email: address, password: password ?? '', secret };
  }

  /** The secret the row holds now, decrypted (setup writes a fresh one). */
  async function storedSecret(adminId: string): Promise<string> {
    const row = await rows.administrator(adminId);
    return serviceCipher.decrypt(row.mfaSecretEncrypted, MFA_SECRET_COLUMN, adminId);
  }

  /** The current code of the row's secret on the spec's clock. */
  async function currentCode(adminId: string): Promise<string> {
    return totpCode(await storedSecret(adminId), clock.now());
  }

  return {
    clock,
    settings,
    rows,
    cipher,
    sessions,
    invites,
    email,
    marks,
    queued,
    auth: new AdminAuthService({
      ...base,
      cipher: serviceCipher,
      sessions,
      ...(overrides.passwords === undefined ? {} : { passwords: overrides.passwords }),
    }),
    admins: new AdminsService({
      ...base,
      cipher: serviceCipher,
      sessions,
      inviteQueue: { queue: async (adminId) => void queued.push(adminId) },
    }),
    createAdministrator,
    storedSecret,
    currentCode,
  };
}

export type AdminWorld = ReturnType<typeof buildAdmin>;

/** Runs `work` in one transaction, as the administrator caller kind does. */
export function inTransaction<T>(database: Database, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return database.$transaction(work);
}

const ROLLED_BACK = Symbol('rolled back');

/**
 * Runs `work` in one transaction and rolls it back, answering what `work` answered: a reading spec
 * writes its rows, reads them and leaves nothing for the next run.
 */
export async function rolledBack<T>(
  database: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let answer: { readonly value: T } | undefined;
  try {
    await database.$transaction(async (tx) => {
      answer = { value: await work(tx) };
      throw ROLLED_BACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
  if (answer === undefined) throw new Error('rolledBack: the work answered nothing');
  return answer.value;
}
