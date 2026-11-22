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
//   - a concurrent duplicate waits on the unique index on (scope, actor_id, key) until the first
//     commits, is refused there (`KeyTakenError`), and is then answered from the committed row. No
//     lock is taken by hand: the database refuses the second claim (ERD §15.26).
//
// WHOSE REQUEST (T018, FR-106; specs/002-identity/contracts/kernel.md "Idempotency"). The key is
// the actor's: the row is keyed by (scope, actor_id, key), where `actor_id` is the server-resolved
// principal and never the client's word, so two actors who send the same key each get their own
// row and neither sees the other's outcome. The kernel refuses to key an anonymous mutation. The row
// also stores a SHA-256 over the canonical JSON of the scope and the input; a reuse by the same
// actor whose hash differs — the same key with another input — is refused with CONFLICT. The
// outcome is never logged, nor is the row.
//
// THE SCOPE is one of the keyed procedures `packages/contracts` lists (`idempotent-procedures.ts`)
// and nothing else: keying is a call the handler makes, and the list is what the pipeline's output
// leak test reads (T027), so a procedure that keys without being listed is a programming error,
// thrown as one.
//
// THE KEY is 16 to 128 characters of `A–Z a–z 0–9 _ -`: a UUID or a base64url string fits, a
// key short enough to collide by accident with another client's in the same scope does not.
//
// RETENTION. A key lives `idempotency_key_ttl_hours` (SRS §3.14, default 24), read through the
// kernel's `SettingsReader` on every call and never held as a constant: a missing or invalid value
// throws before anything runs (FR-034). It is read before the transaction opens, so no transaction
// holds its connection while another query reads the setting. A row past its `expires_at` counts as
// unused and is replaced; the `expire-idempotency-keys` job deletes the rest.
//
// THE EFFECT runs inside the one interactive transaction, under Prisma's default limit (5 s), and
// holds a database connection for as long as it runs. So an effect writes rows and does nothing
// slow: a consumer keeps a gateway or any other network call outside it (ARCHITECTURE §8.1).
//
// ON THE CALLER'S TRANSACTION (B39, the note under T059 in specs/004-sessions/tasks.md, Q1 (a)).
// `run` opens a transaction of its own, but the administrator caller kind runs its handler in one
// transaction and writes the call's audit entry there, so a keyed administrator call needs its key,
// its effect and its entry to commit as one. `runOn(tx, request, effect)` keys on the transaction it
// is handed: it claims the key with `INSERT … ON CONFLICT DO NOTHING`, so a concurrent duplicate
// waits on the first claim and replays its committed row, and the caller's transaction is never
// aborted by a unique violation. It answers `replayed`, which the handler passes on to the kind
// (`AuditTrail.replayed()`): a replay records no second entry, the first call's being the record.
// The retention is read inside the caller's transaction, since it is already open. A caller that
// keys before it locks any row waits on a duplicate's claim holding no lock of the one order.
//
// A REPLAY FROM THE ROWS (T175, R1a; contracts/kernel.md «Idempotency»). A keyed call whose answer
// holds personal data stores less than it answers: ids, or null. `run`'s `replay` reads the answer
// again from what the key stored, on the replay's own transaction, after the request's hash is
// checked; the first call answers the effect's outcome and never calls it. Without `replay`, the
// stored outcome is the answer.
import { createHash } from 'node:crypto';
import { type IdempotentProcedure, isIdempotentProcedure } from '@ijazah/contracts';
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
  readonly actorId: string;
  readonly key: string;
  readonly requestHash: string;
  readonly status: 'in_progress' | 'completed';
  readonly response: unknown;
  readonly expiresAt: Date;
}

export interface NewKey {
  readonly scope: string;
  readonly actorId: string;
  readonly key: string;
  readonly requestHash: string;
  readonly expiresAt: Date;
}

/** A claim refused because another transaction committed the same (scope, actor, key) first. */
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
  find(tx: TTransaction, scope: string, actorId: string, key: string): Promise<StoredKey | null>;
  /** Inserts the key `in_progress`. Throws `KeyTakenError` when the (scope, actor, key) is taken. */
  claim(tx: TTransaction, key: NewKey): Promise<string>;
  /**
   * Inserts the key `in_progress` without aborting `tx` when it is taken: answers its id, or null
   * when the (scope, actor, key) is taken, after waiting on a claim not yet committed.
   */
  claimUnlessTaken(tx: TTransaction, key: NewKey): Promise<string | null>;
  complete(tx: TTransaction, id: string, response: StoredOutcome): Promise<void>;
  remove(tx: TTransaction, id: string): Promise<void>;
  /** Deletes every key whose `expires_at` is not after `now`; answers how many. */
  removeExpired(now: Date): Promise<number>;
}

/**
 * T175: how a replay is answered from the rows: handed the replay's transaction and the stored
 * outcome, it answers what the first call answered, read again.
 */
export type Replay<TTransaction, TResult> = (tx: TTransaction, stored: TResult) => Promise<TResult>;

export interface IdempotentRequest {
  /** The keyed procedure the key applies to: one of `packages/contracts`' list. */
  readonly scope: IdempotentProcedure;
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

/** The hash of what was asked: the scope and the input. The actor is the row's key, not its hash. */
export function requestHash({ scope, input }: Pick<IdempotentRequest, 'scope' | 'input'>): string {
  return createHash('sha256').update(canonicalJson({ scope, input })).digest('hex');
}

function parseKey(key: string): string {
  const parsed = idempotencyKeySchema.safeParse(key);
  if (parsed.success) return parsed.data;
  const code = parsed.error.issues[0]?.code ?? 'invalid_format';
  throw new DomainError('VALIDATION_FAILED', undefined, {
    details: [{ path: 'idempotencyKey', code }],
  });
}

/** The scope and the actor as the kernel accepts them; either refusal is a programming error. */
function parsePrincipal({ scope, actorId }: IdempotentRequest): {
  scope: IdempotentProcedure;
  actorId: string;
} {
  if (!isIdempotentProcedure(scope)) {
    throw new Error(
      `Idempotency: "${String(scope)}" is not a keyed procedure of packages/contracts (T018).`,
    );
  }
  if (typeof actorId !== 'string' || actorId === '') {
    throw new Error('Idempotency: an anonymous mutation cannot be keyed (FR-106, T018).');
  }
  return { scope, actorId };
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
   * a repeat of the same request by the same actor answers the stored outcome without running it
   * again.
   */
  async run<TResult extends JsonValue>(
    request: IdempotentRequest,
    effect: (tx: TTransaction) => Promise<TResult>,
    replay?: Replay<TTransaction, TResult>,
  ): Promise<TResult> {
    const { scope, actorId } = parsePrincipal(request);
    const key = parseKey(request.key);
    const hours = await this.#settings.read(IDEMPOTENCY_RETENTION_SETTING, retentionHours);
    const now = this.#clock();
    const claim: NewKey = {
      scope,
      actorId,
      key,
      requestHash: requestHash(request),
      expiresAt: new Date(addSeconds(now, hours * SECONDS_PER_HOUR)),
    };

    try {
      return await this.#store.transaction((tx) =>
        this.#runOnce(tx, claim, now, effect, replay),
      );
    } catch (error: unknown) {
      if (!(error instanceof KeyTakenError)) throw error;
      // A duplicate committed first; its row is the answer.
      return this.#store.transaction(async (tx) => {
        const row = await this.#store.find(tx, claim.scope, claim.actorId, claim.key);
        if (row === null) throw error;
        return this.#answerOn(tx, this.#replay<TResult>(row, claim.requestHash), replay);
      });
    }
  }

  /**
   * The stored outcome of this request when its key is completed and unexpired, read in a short
   * transaction of its own before the caller's effect; undefined otherwise (B29, T036: a keyed
   * procedure whose gateway call runs outside any transaction asks this first, so a repeat calls no
   * gateway). A key another transaction claimed and has not committed is not seen (READ COMMITTED):
   * `run` then waits on it and answers its outcome. The same key with another input is refused as
   * `run` refuses it.
   */
  async completed<TResult extends JsonValue>(
    request: IdempotentRequest,
  ): Promise<TResult | undefined> {
    const { scope, actorId } = parsePrincipal(request);
    const key = parseKey(request.key);
    const now = this.#clock();
    const row = await this.#store.transaction((tx) => this.#store.find(tx, scope, actorId, key));
    if (row === null || row.expiresAt <= now) return undefined;
    const hash = requestHash(request);
    if (row.requestHash === hash && row.status !== 'completed') return undefined;
    return this.#replay<TResult>(row, hash);
  }

  /**
   * Runs `effect` once for this request on `tx`, the caller's own transaction, and answers its
   * outcome and whether it was replayed from the key's row; the effect does not run on a replay.
   * The same key with another input is refused as `run` refuses it. A concurrent duplicate's claim
   * is waited on and its committed row replayed, and `tx` is never aborted (B39, the note under
   * T059).
   */
  async runOn<TResult extends JsonValue>(
    tx: TTransaction,
    request: IdempotentRequest,
    effect: (tx: TTransaction) => Promise<TResult>,
  ): Promise<{ readonly outcome: TResult; readonly replayed: boolean }> {
    const { scope, actorId } = parsePrincipal(request);
    const key = parseKey(request.key);
    const hours = await this.#settings.read(IDEMPOTENCY_RETENTION_SETTING, retentionHours);
    const now = this.#clock();
    const hash = requestHash(request);

    const existing = await this.#store.find(tx, scope, actorId, key);
    if (existing !== null) {
      if (existing.expiresAt > now) {
        return { outcome: this.#replay<TResult>(existing, hash), replayed: true };
      }
      await this.#store.remove(tx, existing.id);
    }
    const id = await this.#store.claimUnlessTaken(tx, {
      scope,
      actorId,
      key,
      requestHash: hash,
      expiresAt: new Date(addSeconds(now, hours * SECONDS_PER_HOUR)),
    });
    if (id === null) {
      // A duplicate committed its claim first; at READ COMMITTED this statement sees its row.
      const taken = await this.#store.find(tx, scope, actorId, key);
      if (taken === null) throw new KeyTakenError();
      return { outcome: this.#replay<TResult>(taken, hash), replayed: true };
    }
    const outcome = await effect(tx);
    await this.#store.complete(tx, id, { outcome });
    return { outcome, replayed: false };
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
    replay: Replay<TTransaction, TResult> | undefined,
  ): Promise<TResult> {
    const existing = await this.#store.find(tx, claim.scope, claim.actorId, claim.key);
    if (existing !== null) {
      if (existing.expiresAt > now) {
        return this.#answerOn(tx, this.#replay<TResult>(existing, claim.requestHash), replay);
      }
      await this.#store.remove(tx, existing.id);
    }
    const id = await this.#store.claim(tx, claim);
    const outcome = await effect(tx);
    await this.#store.complete(tx, id, { outcome });
    return outcome;
  }

  /** A replay's answer: the stored outcome, or what `replay` reads again from it on `tx` (T175). */
  async #answerOn<TResult extends JsonValue>(
    tx: TTransaction,
    stored: TResult,
    replay: Replay<TTransaction, TResult> | undefined,
  ): Promise<TResult> {
    return replay === undefined ? stored : replay(tx, stored);
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
