// B16 (T080): what the deletion specs share, and nothing a request ever runs. The deletion runs over
// the real database, the kernel's real idempotency, the identity module's real one-time codes and
// sessions, and recording stand-ins of the ports, on the spec's clock. One shared list of events
// says in which order the proof, the transaction, the commit and the work after it were reached
// (B16 check, decisions 1, 3 and 5). The work after the commit is detached from the request; the
// spec collects it and settles it before reading what it did.
import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { ColumnCipher } from '../../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../../platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../../platform/db/spec-database.fixtures.js';
import { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import {
  IdempotencyService,
  type IdempotentRequest,
  type JsonValue,
} from '../../../platform/idempotency/idempotency.service.js';
import type { ProviderGrant } from '../../../platform/ports/sign-in/sign-in.port.js';
import type { StoragePort } from '../../../platform/ports/storage/storage.port.js';
import { AccountConsequences, type TerminationCause } from '../consequences.js';
import { DeletionService, type FileErasure } from '../deletion.service.js';
import { buildIdentity, type Identity, SPEC_ENCRYPTION_KEY, SpecSignInPort } from './identity.js';

/** The column Apple's grant is encrypted under, bound to the identity's row (R-DB-8). */
export const GRANT_COLUMN = 'auth_identities.provider_refresh_token_encrypted';

/** The sign-in port, its revoke recorded among the events and failing once when told to. */
class EventfulSignInPort extends SpecSignInPort {
  readonly #events: string[];
  #failRevoke = false;

  constructor(events: string[]) {
    super();
    this.#events = events;
  }

  failNextRevoke(): void {
    this.#failRevoke = true;
  }

  override async verifyIdentityToken(
    ...args: Parameters<SpecSignInPort['verifyIdentityToken']>
  ): ReturnType<SpecSignInPort['verifyIdentityToken']> {
    this.#events.push('verify');
    return super.verifyIdentityToken(...args);
  }

  override async revoke(grant: ProviderGrant): Promise<void> {
    this.#events.push('revoke');
    await super.revoke(grant);
    if (this.#failRevoke) {
      this.#failRevoke = false;
      throw new Error('spec provider: unreachable');
    }
  }
}

/** The storage port's removal, recording each key and failing once when told to. */
export class SpecRemovingStorage implements Pick<StoragePort, 'remove'> {
  readonly removed: string[] = [];
  readonly #events: string[];
  #failing = false;

  constructor(events: string[]) {
    this.#events = events;
  }

  failNext(): void {
    this.#failing = true;
  }

  async remove(key: string): Promise<void> {
    this.#events.push('remove');
    if (this.#failing) {
      this.#failing = false;
      throw new Error('spec storage: unreachable');
    }
    this.removed.push(key);
  }
}

/** Another module's files of a deleted person (the verification module's documents in main.ts). */
export class SpecFileErasure implements FileErasure {
  readonly erased: string[] = [];
  readonly #events: string[];
  #failing = false;

  constructor(events: string[]) {
    this.#events = events;
  }

  failNext(): void {
    this.#failing = true;
  }

  async eraseFilesOf(userId: string): Promise<void> {
    this.#events.push('erase-files');
    if (this.#failing) {
      this.#failing = false;
      throw new Error('spec erasure: storage unreachable');
    }
    this.erased.push(userId);
  }
}

/** The deletion over the spec's database and stand-ins, beside the rest of the identity module. */
export function buildDeletion(
  database: Database,
  overrides: Parameters<typeof buildIdentity>[1] = {},
) {
  const identity: Identity = buildIdentity(database, {
    ...overrides,
    settings: { idempotency_key_ttl_hours: 24, ...overrides.settings },
  });
  const events: string[] = [];
  const signInPort = new EventfulSignInPort(events);
  const storage = new SpecRemovingStorage(events);
  const files = new SpecFileErasure(events);
  const consequences = new AccountConsequences();
  const terminations: { readonly userId: string; readonly cause: TerminationCause }[] = [];
  consequences.subscribe(async (_tx, userId, cause) => {
    events.push('consequence');
    terminations.push({ userId, cause });
  });
  const kernel = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings: identity.settings,
    clock: identity.clock.now,
  });
  const keyed: IdempotentRequest[] = [];
  const idempotency = {
    async run<TResult extends JsonValue>(
      request: IdempotentRequest,
      effect: (tx: Transaction) => Promise<TResult>,
    ): Promise<TResult> {
      keyed.push(request);
      events.push('transaction');
      const outcome = await kernel.run(request, effect);
      events.push('committed');
      return outcome;
    },
  };
  const reports: unknown[] = [];
  const pending: Promise<void>[] = [];
  const deletion = new DeletionService({
    database,
    settings: identity.settings,
    encryptionKey: identity.encryptionKey,
    cipher: identity.cipher,
    now: identity.clock.now,
    consequences,
    marks: identity.marks,
    signIn: signInPort,
    email: overrides.email ?? identity.email,
    storage,
    idempotency,
    codes: identity.codes,
    log: { warn: (entry: object) => void identity.warnings.push(entry) },
    fileErasures: [files],
    report: (error) => void reports.push(error),
    defer: (work) => void pending.push(work),
  });
  return {
    identity,
    deletion,
    events,
    signInPort,
    storage,
    files,
    consequences,
    terminations,
    keyed,
    reports,
    /** Waits for the work the deletions detached after their commit. */
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

export type Deletion = ReturnType<typeof buildDeletion>;

/**
 * Apple's grant, encrypted to the identity row it is written on, as onboarding encrypts it: under
 * the spec key, the previous one in a rotated world (T134).
 */
export function encryptedGrant(refreshToken: string, identityId: string): Uint8Array {
  return new ColumnCipher(SPEC_ENCRYPTION_KEY).encrypt(refreshToken, GRANT_COLUMN, identityId);
}

/** A fresh identity row id. */
export function identityId(): string {
  return randomUUID();
}

function databaseUrl(): string {
  // T124: from the environment only, refused naming the variable when it is missing.
  return specDatabaseUrl('DATABASE_URL');
}

async function withClient<T>(work: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}

/**
 * An audit entry naming the person, written as the administrator kind writes one (the audit log is
 * the admin module's, so a spec of this module reaches it only as raw rows, as `rowsNaming` does).
 */
export function writeAuditEntryAbout(userId: string): Promise<void> {
  return withClient(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, mfa_secret_encrypted, display_name, is_active, updated_at)
       VALUES ($1, 'spec-hash', '\\x00', 'Spec administrator', true, now()) RETURNING id`,
      [`spec-admin-${randomUUID()}@example.invalid`],
    );
    const adminId = rows[0]?.id;
    if (adminId === undefined) throw new Error('no administrator was written');
    await db.query(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, target_label)
       VALUES ($1, 'teachers.suspend', 'user', $2, $3)`,
      [adminId, userId, `حساب · ${userId}`],
    );
  });
}

/** How many audit entries name the person. */
export function auditEntriesAbout(userId: string): Promise<number> {
  return withClient(async (db) => {
    const { rows } = await db.query<{ n: string }>(
      'SELECT count(*) AS n FROM audit_logs WHERE target_id = $1',
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  });
}
