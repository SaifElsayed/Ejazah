// T102: idempotency keyed in Postgres, not Redis, so one transaction covers key and effect
// (FR-042, R-API-14, research R-14, ADR 0008). The test is T096.
//
// A client retries a mutation with the same idempotency key. The operation runs inside one
// database transaction that first claims the key, then runs the effect, then stores the outcome
// on the key's row and commits all three together. So:
//
//   - a repeat after the commit finds the row and gets the stored outcome; the effect never runs
//     again;
//   - a crash or a failed effect rolls the claim back with everything else, so the client is never
//     locked out of its own retry for the length of the retention;
//   - a concurrent duplicate waits on the unique index on (scope, key) until the first commits,
//     is refused there (`KeyTakenError`), and is then answered from the committed row. No lock is
//     taken by hand: the database refuses the second claim (ERD §15.16).
//
// WHOSE REQUEST. A key is the client's, so it says nothing about who sent it. The row stores a
// SHA-256 over the canonical JSON of the server-resolved actor, the scope and the input; a reuse
// whose hash differs — another actor, or the same actor with another input — is refused with
// CONFLICT and never receives the stored outcome. The outcome is never logged, nor is the row.
//
// THE KEY is 16 to 128 characters of `A–Z a–z 0–9 _ -`: a UUID or a base64url string fits, a
// key short enough to collide by accident with another client's in the same scope does not.
//
// RETENTION. A key lives `idempotency_key_ttl_hours` (SRS §3.14, default 24), read through the
// kernel's `SettingsReader` on every call and never held as a constant: a missing or invalid value
// throws before anything runs (FR-034). It is read before the transaction opens, so no transaction
// holds its connection while another query reads the setting. A row past its `expires_at` counts as
// unused and is replaced; the `expire-idempotency-keys` job deletes the rest.
import { createHash } from 'node:crypto';
import { addSeconds } from '@ijazah/time';
import { z } from 'zod';
import { DomainError } from '../errors/domain-error.js';
import type { SettingsReader } from '../settings/settings-reader.js';

/** The setting that holds how many hours a key is kept (ADR 0008). */
export const IDEMPOTENCY_RETENTION_SETTING = 'idempotency_key_ttl_hours';

const retentionHours = z.number().int().positive();

const SECONDS_PER_HOUR = 3600;

/** A client's idempotency key. */
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

/** What an idempotent operation may return: it is stored as JSON and replayed as stored. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** What the row stores: the outcome, wrapped so a `null` outcome is still an outcome. */
export interface StoredOutcome {
  readonly outcome: JsonValue;
}

export interface StoredKey {
  readonly id: string;
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly status: 'in_progress' | 'completed';
  readonly response: unknown;
  readonly expiresAt: Date;
}

export interface NewKey {
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly expiresAt: Date;
}

/** A claim refused because another transaction committed the same (scope, key) first. */
export class KeyTakenError extends Error {
  constructor() {
    super('The idempotency key was claimed by a transaction that committed first');
    this.name = 'KeyTakenError';
  }
}

/** Where keys are kept: `idempotency.repository.ts`, or a fake in a spec. */
export interface IdempotencyStore<TTransaction> {
  /** Runs `work` in one transaction: all of it commits, or none of it does. */
  transaction<T>(work: (tx: TTransaction) => Promise<T>): Promise<T>;
  find(tx: TTransaction, scope: string, key: string): Promise<StoredKey | null>;
  /** Inserts the key `in_progress`. Throws `KeyTakenError` when the (scope, key) is taken. */
  claim(tx: TTransaction, key: NewKey): Promise<string>;
  complete(tx: TTransaction, id: string, response: StoredOutcome): Promise<void>;
  remove(tx: TTransaction, id: string): Promise<void>;
  /** Deletes every key whose `expires_at` is not after `now`; answers how many. */
  removeExpired(now: Date): Promise<number>;
}

export interface IdempotentRequest {
  /** The procedure or job the key applies to. */
  readonly scope: string;
  /** The client's idempotency key, as received. */
  readonly key: string;
  /** Who is asking, as the server resolved it (the request context), never as the client said. */
  readonly actorId: string;
  /** The validated input of the operation. */
  readonly input: unknown;
}

export interface IdempotencyServiceOptions<TTransaction> {
  readonly store: IdempotencyStore<TTransaction>;
  readonly settings: SettingsReader;
  /** The server's clock. */
  readonly clock?: () => Date;
}

/** JSON with every object's keys in order, so one request always hashes the same way. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_name, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const entries = Object.entries(inner as Record<string, unknown>);
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries);
  });
}

export function requestHash({ actorId, scope, input }: IdempotentRequest): string {
  return createHash('sha256')
    .update(canonicalJson({ actor: actorId, scope, input }))
    .digest('hex');
}

function parseKey(key: string): string {
  const parsed = idempotencyKeySchema.safeParse(key);
  if (parsed.success) return parsed.data;
  const code = parsed.error.issues[0]?.code ?? 'invalid_format';
  throw new DomainError('VALIDATION_FAILED', undefined, {
    details: [{ path: 'idempotencyKey', code }],
  });
}

function outcomeOf(row: StoredKey): JsonValue {
  const { response } = row;
  if (response === null || typeof response !== 'object' || !('outcome' in response)) {
    throw new Error('A completed idempotency key holds no outcome');
  }
  return (response as StoredOutcome).outcome;
}

export class IdempotencyService<TTransaction> {
  readonly #store: IdempotencyStore<TTransaction>;
  readonly #settings: SettingsReader;
  readonly #clock: () => Date;

  constructor({
    store,
    settings,
    clock = () => new Date(),
  }: IdempotencyServiceOptions<TTransaction>) {
    this.#store = store;
    this.#settings = settings;
    this.#clock = clock;
  }

  /**
   * Runs `effect` once for this request, in the transaction it is handed, and answers its outcome;
   * a repeat of the same request answers the stored outcome without running it again.
   */
  async run<TResult extends JsonValue>(
    request: IdempotentRequest,
    effect: (tx: TTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const key = parseKey(request.key);
    const hours = await this.#settings.read(IDEMPOTENCY_RETENTION_SETTING, retentionHours);
    const now = this.#clock();
    const claim: NewKey = {
      scope: request.scope,
      key,
      requestHash: requestHash(request),
      expiresAt: new Date(addSeconds(now, hours * SECONDS_PER_HOUR)),
    };

    try {
      return await this.#store.transaction((tx) => this.#runOnce(tx, claim, now, effect));
    } catch (error: unknown) {
      if (!(error instanceof KeyTakenError)) throw error;
      // A duplicate committed first; its row is the answer.
      return this.#store.transaction(async (tx) => {
        const row = await this.#store.find(tx, claim.scope, claim.key);
        if (row === null) throw error;
        return this.#replay<TResult>(row, claim.requestHash);
      });
    }
  }

  /** Deletes every key past its retention (the `expire-idempotency-keys` job). */
  async sweepExpired(): Promise<number> {
    return this.#store.removeExpired(this.#clock());
  }

  async #runOnce<TResult extends JsonValue>(
    tx: TTransaction,
    claim: NewKey,
    now: Date,
    effect: (tx: TTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    const existing = await this.#store.find(tx, claim.scope, claim.key);
    if (existing !== null) {
      if (existing.expiresAt > now) return this.#replay<TResult>(existing, claim.requestHash);
      await this.#store.remove(tx, existing.id);
    }
    const id = await this.#store.claim(tx, claim);
    const outcome = await effect(tx);
    await this.#store.complete(tx, id, { outcome });
    return outcome;
  }

  #replay<TResult extends JsonValue>(row: StoredKey, hash: string): TResult {
    // Checked before anything of the row is read, so a refused caller learns nothing of it.
    if (row.requestHash !== hash) {
      throw new DomainError(
        'CONFLICT',
        'This idempotency key was already used for a different request.',
      );
    }
    if (row.status !== 'completed') {
      throw new DomainError('CONFLICT', 'This request is still being processed.');
    }
    return outcomeOf(row) as TResult;
  }
}
