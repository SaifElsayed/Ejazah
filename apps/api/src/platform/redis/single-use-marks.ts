// B9 (T047, owner's decision 2026-10-20): single-use marks in Redis, the one Redis operation the
// identity module needs. A provider nonce is placed when it is minted and taken when a sign-in
// presents it (research R-103); an onboarding token's `jti` is placed when the account is completed,
// so a second presentation finds it (R-102). A mark names no one (a random value), and losing one
// costs a person one more sign-in and nothing else, so Redis is the right store (ARCHITECTURE §2).
//
// `place` is `SET key 1 PXAT <instant> NX`: true only where no mark was, and the mark lapses at the
// instant its caller names (the nonce's or the token's own expiry), so no lifetime is converted
// here. `take` is `DEL key`: true only where the mark was live, so two takes of one mark never both
// succeed (Redis runs each command alone). `has` is `EXISTS key`, which leaves the mark. Keys are
// `ijazah:mark:<kind>:<value>`; a value carrying the separator, or none, is refused, so one kind's
// value can never be read as another kind's key.
//
// The connection is opened by `createRedisSingleUseMarks` as the rate limiter opens its own: lazily,
// one retry per command, so a request fails promptly while Redis is down, and `rediss://` verifies
// the certificate as the driver does by default (R-SEC-11). `main.ts` binds it (B10).
import { Redis } from 'ioredis';

/** What a mark is for: each kind its own key space. */
export type MarkKind = 'provider-nonce' | 'onboarding' | 'admin-invite';

export interface SingleUseMarks {
  /** Places the mark until `expiresAt`; true when it was not there already. */
  place(kind: MarkKind, value: string, expiresAt: Date): Promise<boolean>;
  /** Takes the mark away; true when it was there and live. */
  take(kind: MarkKind, value: string): Promise<boolean>;
  /** Whether the mark is there and live, leaving it. */
  has(kind: MarkKind, value: string): Promise<boolean>;
}

/** The three Redis commands the marks send. */
export interface MarkCommands {
  set(
    key: string,
    value: string,
    pxat: 'PXAT',
    unixMilliseconds: number,
    nx: 'NX',
  ): Promise<string | null>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
}

const PREFIX = 'ijazah:mark';

/** The key of a mark; refuses a value that is empty or carries the separator. */
export function markKey(kind: MarkKind, value: string): string {
  if (value === '' || value.includes(':')) {
    throw new TypeError('A mark value is a non-empty token without ":".');
  }
  return `${PREFIX}:${kind}:${value}`;
}

/** Refuses a Date that holds no instant. */
export function assertInstant(expiresAt: Date): void {
  if (Number.isNaN(expiresAt.getTime())) throw new RangeError('A mark lapses at an instant.');
}

export class RedisSingleUseMarks implements SingleUseMarks {
  readonly #redis: MarkCommands;

  constructor(redis: MarkCommands) {
    this.#redis = redis;
  }

  async place(kind: MarkKind, value: string, expiresAt: Date): Promise<boolean> {
    const key = markKey(kind, value);
    assertInstant(expiresAt);
    return (await this.#redis.set(key, '1', 'PXAT', expiresAt.getTime(), 'NX')) === 'OK';
  }

  async take(kind: MarkKind, value: string): Promise<boolean> {
    return (await this.#redis.del(markKey(kind, value))) === 1;
  }

  async has(kind: MarkKind, value: string): Promise<boolean> {
    return (await this.#redis.exists(markKey(kind, value))) === 1;
  }
}

/** The process's marks, over the Redis at `redisUrl`. */
export function createRedisSingleUseMarks({
  redisUrl,
  onError,
}: {
  readonly redisUrl: string;
  /** Told when the connection fails; the command still fails, so a request is refused. */
  readonly onError: (error: unknown) => void;
}): SingleUseMarks {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.on('error', onError);
  return new RedisSingleUseMarks(redis);
}
