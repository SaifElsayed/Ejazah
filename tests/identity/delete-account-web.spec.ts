// T081 — the web deletion end to end (FR-141, FR-143, FR-145; public-pages.md "The pages").
//
// Real HTTP to the real pages (`deleteAccountRoutes`, each mounted under its path through the
// kernel's helper `webRoute`, the path taken off the request's URL as Express's `use` does; Nest is
// the API's dependency, not the test tree's), over the identity module's real services
// (`createIdentityServices`, its public entry) and a database of its own, created and migrated here,
// so the deletion's own migrations apply whatever the shared database holds. The account is planted
// and the rows read with plain SQL, as the other end-to-end case of the test tree does
// (tests/dev/emit-recipient-event.spec.ts): the module's spec fixtures are its own (R-API-3). The
// mail port records what it is handed, read back for the code.
//
// The page-level cases are `apps/api/src/modules/identity/web/delete-account.spec.ts`, over a
// recording fake of the deletion. This case needs the deletion's bodies (T082, lane A of B16):
// before they land the email step answers 500, and the first assertion names the step-zero
// rejection.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import {
  closeDatabase,
  openDatabase,
  type Database,
} from '../../apps/api/src/platform/db/prisma.repository';
import { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import type { EmailPort, Mail } from '../../apps/api/src/platform/ports/email/email.port';
import { MemorySingleUseMarks } from '../../apps/api/src/platform/redis/single-use-marks.fixtures';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { webRoute } from '../../apps/api/src/platform/web/route';
import { createOngoingEnrollments } from '../../apps/api/src/modules/booking/index';
import {
  AccountConsequences,
  createIdentityServices,
  deleteAccountRoutes,
} from '../../apps/api/src/modules/identity/index';
import { connect, createEmptyDatabase, type FreshDatabase, migrate } from '../seed/fresh-database';

const SUPPORT = 'support@ijazah.invalid';

/** The seeded values the identity services read (prisma/seed.ts, data-model §4). */
const SEEDED: Readonly<Record<string, unknown>> = {
  otp_code_ttl_minutes: 10,
  otp_max_attempts: 5,
  onboarding_token_ttl_minutes: 15,
  session_access_ttl_minutes: 15,
  session_refresh_ttl_days: 30,
  session_refresh_grace_seconds: 30,
  provider_nonce_ttl_minutes: 10,
  terms_version: '2026-10',
  document_link_ttl_seconds: 300,
};

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (!Object.hasOwn(SEEDED, key)) throw new SettingError(key, 'missing');
    return schema.parse(SEEDED[key]);
  },
};

/** Every limit admits every call here; the limits are the page specs'. */
const admitAll = new RateLimiter({
  settings: { read: async (_key, schema) => schema.parse({ limit: 1_000, window_seconds: 60 }) },
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 1),
});

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('no call to this port is expected here'));

/** The mail port, keeping every mail it is handed. */
class Mailbox implements EmailPort {
  readonly mails: Mail[] = [];

  async deliver(mail: Mail): Promise<void> {
    this.mails.push(mail);
  }

  /** The six-digit code the last mail to `to` carried. */
  codeFor(to: string): string {
    const code = [...this.mails]
      .reverse()
      .find((mail) => mail.to === to)
      ?.text.match(/\b\d{6}\b/)?.[0];
    if (code === undefined) throw new Error(`no code was mailed to ${to}`);
    return code;
  }
}

describe('the web deletion end to end (T081, FR-143)', () => {
  const lines: string[] = [];
  const mailbox = new Mailbox();
  let fresh: FreshDatabase;
  let db: pg.Client;
  let database: Database;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    fresh = await createEmptyDatabase();
    const migrated = await migrate(fresh);
    if (migrated.exitCode !== 0) throw new Error(`migrate failed:\n${migrated.output}`);
    db = await connect(fresh.applicationUrl);
    database = openDatabase(fresh.applicationUrl, {
      poolMax: 2,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 30_000,
    });
    const log = createLogger({
      level: 'info',
      destination: { write: (line) => void lines.push(line) },
    });
    const encryptionKey = randomBytes(32).toString('base64');
    const services = createIdentityServices({
      database,
      settings,
      encryptionKey,
      cipher: new ColumnCipher(encryptionKey),
      marks: new MemorySingleUseMarks(() => new Date()),
      signIn: {
        verifyIdentityToken: unexpected,
        exchangeAuthorization: unexpected,
        revoke: unexpected,
      },
      email: mailbox,
      storage: { temporaryLink: unexpected, remove: unexpected },
      log: {
        warn: (entry: unknown) => void lines.push(JSON.stringify({ level: 'warn', entry })),
        info: (entry: unknown) => void lines.push(JSON.stringify({ level: 'info', entry })),
      },
      payment: { registerPayoutRecipient: unexpected },
      idempotency: { run: unexpected },
      consequences: new AccountConsequences(),
      // T080 of specs/004-sessions (rule d): booking's count bound as `main.ts` binds it.
      ongoingEnrollments: createOngoingEnrollments({ settings }),
    });
    const routes = deleteAccountRoutes({
      deletion: services.deletion,
      supportEmail: SUPPORT,
      rateLimiter: admitAll,
    });
    // Longest path first, as the application mounts them.
    const mounted = Object.entries(routes)
      .sort(([a], [b]) => b.length - a.length)
      .map(([path, route]) => [path, webRoute({ rateLimiter: admitAll, log }, route)] as const);
    server = createServer((request, response) => {
      const url = request.url ?? '/';
      const found = mounted.find(
        ([path]) => url === path || url.startsWith(`${path}/`) || url.startsWith(`${path}?`),
      );
      if (found === undefined) {
        response.statusCode = 404;
        response.end();
        return;
      }
      const [path, handler] = found;
      request.url = url.slice(path.length) || '/';
      handler(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise((resolve) =>
      server === undefined ? resolve(undefined) : server.close(resolve),
    );
    if (database !== undefined) await closeDatabase(database);
    await db?.end();
    await fresh?.drop();
  });

  function submit(path: string, fields: Readonly<Record<string, string>>): Promise<Response> {
    return fetch(`${origin}${path}`, {
      method: 'POST',
      body: new URLSearchParams(fields),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
  }

  /** The purposes of the codes written for `destination`. */
  async function codePurposes(destination: string): Promise<string[]> {
    const { rows } = await db.query<{ purpose: string }>(
      'SELECT purpose::text AS purpose FROM otp_codes WHERE destination = $1',
      [destination],
    );
    return rows.map((row) => row.purpose);
  }

  /** How many accounts hold `email`. */
  async function accountsHolding(email: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE email = $1',
      [email],
    );
    return rows[0]?.n ?? 0;
  }

  it('answers every address alike, codes only the account, and deletes it with the mailed code', async () => {
    const email = await plantStudent(db);
    const stranger = `stranger-${randomUUID()}@example.com`;

    const forStranger = await submit('/delete-account', { email: stranger });
    const forAccount = await submit('/delete-account', { email });
    // Any error the pages logged is named here, so a failure shows its cause.
    expect(unexpectedErrors(lines)).toEqual([]);
    expect(forStranger.status).toBe(200);
    expect(forAccount.status).toBe(200);
    expect((await forStranger.text()).replaceAll(stranger, 'X')).toBe(
      (await forAccount.text()).replaceAll(email, 'X'),
    );

    // The code is written for the account alone, and its mail leaves after the commit.
    await vi.waitFor(() => expect(mailbox.mails.some((mail) => mail.to === email)).toBe(true));
    expect(await codePurposes(email)).toEqual(['account_deletion']);
    expect(await codePurposes(stranger)).toEqual([]);
    expect(mailbox.mails.some((mail) => mail.to === stranger)).toBe(false);

    // A wrong code renders the code step again; the account stands.
    const wrong = await submit('/delete-account/confirm', { email, code: '000000' });
    expect(wrong.status).toBe(400);
    expect(await accountsHolding(email)).toBe(1);

    const done = await submit('/delete-account/confirm', { email, code: mailbox.codeFor(email) });
    expect(unexpectedErrors(lines)).toEqual([]);
    expect(done.status).toBe(200);
    const page = await done.text();
    expect(page).toContain(email);
    expect(page).toContain(SUPPORT);
    // The address is free: no account holds it any more (FR-141).
    expect(await accountsHolding(email)).toBe(0);
  });
});

/** The messages of the errors the pages logged as unexpected. */
function unexpectedErrors(lines: readonly string[]): string[] {
  return lines
    .map((line) => JSON.parse(line) as { level?: string | number; err?: { message?: string } })
    .filter((record) => record.level === 'error' || record.level === 50)
    .map((record) => record.err?.message ?? '');
}

/** An active student with an email account, as `onboarding.complete` leaves one; its address. */
async function plantStudent(db: pg.Client): Promise<string> {
  const userId = randomUUID();
  const email = `student-${userId}@example.com`;
  await db.query(
    `INSERT INTO users (id, email, gender, date_of_birth, display_name, preferred_language, timezone,
                        account_status, updated_at)
     VALUES ($1, $2, 'female', '1990-04-12', 'Student', 'ar', 'Africa/Cairo', 'active', now())`,
    [userId, email],
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, updated_at) VALUES ($1, 'student', 'active', now())`,
    [userId],
  );
  return email;
}
