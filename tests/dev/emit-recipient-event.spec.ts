// T079 — `scripts/dev/emit-recipient-event.ts`, the stand-in's signed recipient verdict for one
// teacher (quickstart §6). It refuses anywhere but a local development or test machine, before it
// reads anything (the owner's condition 3 at B15's check); its event is built, signed under the
// secret the API verifies with and sent by the gateway stand-in's harness
// (`tests/support/gateway-stand-in.ts`, T013), never by hand; and its event id is decided by the
// reference, the verdict and the reason, so repeating a command is a replay.
//
// THE END-TO-END CASE is real HTTP to the real route (`createPaymentWebhookRoute`, mounted under its
// path as the application mounts it, the path taken off the request's URL as Express's `use` does;
// Nest is the API's dependency, not the test tree's) over a database of its own, created and
// migrated here, with the identity module's real entries: the same command twice leaves one
// `payment_events` row and the verified instant of the first. It needs lane A of B15's `markPayoutVerified`; before that lands the route
// answers 500 and the first assertion names the step-zero rejection.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { openDatabase, type Database } from '../../apps/api/src/platform/db/prisma.repository';
import { createLogger } from '../../apps/api/src/platform/logging/logger';
import { createPaymentPort } from '../../apps/api/src/platform/ports/payment/index';
import { payoutRefHash } from '../../apps/api/src/modules/identity/index';
import {
  createPaymentWebhookRoute,
  PAYMENT_WEBHOOK_PATH,
} from '../../apps/api/src/modules/payments/index';
import {
  type Connection,
  eventIdOf,
  parseArguments,
  refusalOf,
  run,
  type RunDependencies,
  verdictEvent,
} from '../../scripts/dev/emit-recipient-event';
import { connect, createEmptyDatabase, type FreshDatabase, migrate } from '../seed/fresh-database';
import { gatewayStandIn, type StandInEvent } from '../support/gateway-stand-in';

const LOCAL = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://ijazah_app:secret@localhost:5432/ijazah',
};
const API = 'http://localhost:3000';

describe('the guard (owner, condition 3)', () => {
  it('runs on a development or test machine whose database and API are both local', () => {
    expect(refusalOf(LOCAL, API)).toBeNull();
    expect(refusalOf({ ...LOCAL, NODE_ENV: 'test' }, API)).toBeNull();
    expect(
      refusalOf(
        { ...LOCAL, DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/ijazah' },
        'http://127.0.0.1:3000',
      ),
    ).toBeNull();
    expect(
      refusalOf(
        { ...LOCAL, DATABASE_URL: 'postgresql://u:p@[::1]:5432/ijazah' },
        'http://[::1]:3000',
      ),
    ).toBeNull();
  });

  it('refuses unless NODE_ENV is development or test', () => {
    for (const NODE_ENV of ['production', 'staging', '', undefined]) {
      expect(refusalOf({ ...LOCAL, NODE_ENV }, API)).toMatch(/NODE_ENV/);
    }
  });

  it('refuses a database that is not on this machine, however its address is written', () => {
    for (const DATABASE_URL of [
      'postgresql://u:p@db.example.com:5432/ijazah',
      'postgresql://u:p@10.0.0.5:5432/ijazah',
      'postgresql://u:p@localhost.example.com/ijazah',
      'postgresql://u:p@localhost/ijazah?host=db.example.com',
      'postgresql:///ijazah',
      'not a url',
      '',
      undefined,
    ]) {
      expect(refusalOf({ ...LOCAL, DATABASE_URL }, API)).toMatch(/database/);
    }
  });

  it('refuses an API that is not on this machine', () => {
    for (const api of [
      'https://api.ijazah.example',
      'http://192.168.1.20:3000',
      'http://localhost.evil.example',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(refusalOf(LOCAL, api)).toMatch(/API/);
    }
  });

  it('refuses before it reads anything: no database is opened and nothing is sent', async () => {
    const connected: string[] = [];
    const sent: string[] = [];
    const errors: string[] = [];
    const code = await run(
      ['--teacher', randomUUID(), '--verdict', 'verified'],
      { ...LOCAL, DATABASE_URL: 'postgresql://u:p@db.example.com/ijazah' },
      {
        connect: (url) => {
          connected.push(url);
          return Promise.reject(new Error('must not connect'));
        },
        fetch: (input) => {
          sent.push(String(input));
          return Promise.reject(new Error('must not send'));
        },
        out: () => undefined,
        err: (line) => void errors.push(line),
      },
    );

    expect(code).not.toBe(0);
    expect(connected).toEqual([]);
    expect(sent).toEqual([]);
    expect(errors.join('\n')).toMatch(/database/);
  });
});

describe('the command line (quickstart §6)', () => {
  const teacher = randomUUID();

  it('reads a teacher, a verdict and a reason for a rejection', () => {
    expect(parseArguments(['--teacher', teacher, '--verdict', 'verified'])).toEqual({
      teacher,
      verdict: 'verified',
    });
    expect(
      parseArguments(['--teacher', teacher, '--verdict', 'rejected', '--reason', 'name mismatch']),
    ).toEqual({ teacher, verdict: 'rejected', reason: 'name mismatch' });
    expect(
      parseArguments([
        '--teacher',
        teacher,
        '--verdict',
        'verified',
        '--api',
        'http://127.0.0.1:4000',
      ]),
    ).toEqual({ teacher, verdict: 'verified', api: 'http://127.0.0.1:4000' });
  });

  it.each([
    [[]],
    [['--verdict', 'verified']],
    [['--teacher', 'not-a-uuid', '--verdict', 'verified']],
    [['--teacher', teacher]],
    [['--teacher', teacher, '--verdict', 'approved']],
    [['--teacher', teacher, '--verdict', 'verified', '--reason', 'a verified event has none']],
    [['--teacher', teacher, '--verdict', 'rejected', '--reason', '']],
  ])('refuses %j, saying how it is used', (argv) => {
    expect(parseArguments(argv)).toMatch(/usage/);
  });
});

describe('the event (T013: built and sent by the gateway stand-in harness)', () => {
  const recipientRef = 'fake_rcp_0193d1b0-7a4e-7c55-9d2f-3b1e8a6c4f21';
  const KEY = randomBytes(32).toString('base64');
  const harness = gatewayStandIn({ origin: API, config: { ENCRYPTION_KEY: KEY } });
  const bodyOf = (event: StandInEvent): unknown => JSON.parse(event.rawBody.toString('utf8'));

  it('is the stand-in’s body, its id decided by the reference, the verdict and the reason', () => {
    const rejected = verdictEvent(harness, recipientRef, 'rejected', 'name mismatch');

    expect(bodyOf(rejected)).toEqual({
      id: expect.stringMatching(/^fake_evt_[0-9a-f]{32}$/),
      type: 'recipient_rejected',
      recipient: recipientRef,
      reason: 'name mismatch',
    });
    expect(rejected.providerEventId).toBe(eventIdOf(recipientRef, 'rejected', 'name mismatch'));
    expect(verdictEvent(harness, recipientRef, 'rejected', 'name mismatch').providerEventId).toBe(
      rejected.providerEventId,
    );
    expect(eventIdOf(recipientRef, 'rejected', 'closed')).not.toBe(rejected.providerEventId);
    expect(eventIdOf(recipientRef, 'verified')).not.toBe(rejected.providerEventId);
    expect(eventIdOf('fake_rcp_other', 'rejected', 'name mismatch')).not.toBe(
      rejected.providerEventId,
    );
    expect(bodyOf(verdictEvent(harness, recipientRef, 'verified'))).toEqual({
      id: eventIdOf(recipientRef, 'verified'),
      type: 'recipient_verified',
      recipient: recipientRef,
    });
  });

  it.each([
    ['the configured webhook secret', { PAYMENT_GATEWAY_WEBHOOK_SECRET: 'configured' }],
    ['the secret derived from ENCRYPTION_KEY', {}],
  ])('is signed so the API’s payment port verifies it, under %s', async (_case, secret) => {
    const config = { ENCRYPTION_KEY: randomBytes(32).toString('base64'), ...secret };
    const { rawBody, headers } = verdictEvent(
      gatewayStandIn({ origin: API, config }),
      recipientRef,
      'rejected',
      'name mismatch',
    );

    await expect(
      createPaymentPort({ PAYMENT_GATEWAY: 'fake', ...config }).verifyAndParseEvent(
        rawBody,
        headers,
      ),
    ).resolves.toEqual({
      type: 'recipient_rejected',
      providerEventId: expect.any(String),
      recipientRef,
      reason: 'name mismatch',
    });
  });

  it('reaches the payments module’s webhook path, and the same command sends the same event', async () => {
    const teacher = randomUUID();
    const profileId = randomUUID();
    const encrypted = new ColumnCipher(KEY).encrypt(
      recipientRef,
      'teacher_profiles.payout_account_ref_encrypted',
      profileId,
    );
    const sent: { url: string; body: Buffer; headers: Record<string, string> }[] = [];
    const printed: string[] = [];
    const profileRow: Connection = {
      query: <Row extends pg.QueryResultRow>() =>
        Promise.resolve({
          rows: [{ id: profileId, ref: encrypted }],
        } as unknown as pg.QueryResult<Row>),
      end: () => Promise.resolve(),
    };
    const dependencies: RunDependencies = {
      connect: () => Promise.resolve(profileRow),
      fetch: (input, init) => {
        sent.push({
          url: String(input),
          body: Buffer.from(init?.body as Uint8Array),
          headers: init?.headers as Record<string, string>,
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      },
      out: (line) => void printed.push(line),
      err: (line) => void printed.push(line),
    };
    const argv = ['--teacher', teacher, '--verdict', 'verified'];
    const env = { ...LOCAL, ENCRYPTION_KEY: KEY };

    expect(await run(argv, env, dependencies)).toBe(0);
    expect(await run(argv, env, dependencies)).toBe(0);

    expect(sent.map((request) => request.url)).toEqual([
      `${API}${PAYMENT_WEBHOOK_PATH}`,
      `${API}${PAYMENT_WEBHOOK_PATH}`,
    ]);
    expect(sent[1]?.body.equals(sent[0]?.body ?? Buffer.alloc(0))).toBe(true);
    await expect(
      createPaymentPort({ PAYMENT_GATEWAY: 'fake', ENCRYPTION_KEY: KEY }).verifyAndParseEvent(
        sent[0]?.body ?? Buffer.alloc(0),
        sent[0]?.headers ?? {},
      ),
    ).resolves.toEqual({
      type: 'recipient_verified',
      providerEventId: eventIdOf(recipientRef, 'verified'),
      recipientRef,
    });
    const line = `emit-recipient-event: recipient_verified event ${eventIdOf(recipientRef, 'verified')} for teacher ${teacher}: HTTP 200`;
    expect(printed).toEqual([line, line]);
  });
});

// The end-to-end case: a database of its own, migrated, with one approved teacher whose payout is
// configured and pending, and the real route listening on this machine.
// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('a replay is a no-op end to end (T079, FR-PAYG-4)', { tags: ['database'] }, () => {
  const ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const recipientRef = `fake_rcp_${randomUUID()}`;
  const lines: string[] = [];
  let fresh: FreshDatabase;
  let db: pg.Client;
  let database: Database;
  let server: Server;
  let origin: string;
  let teacherUserId: string;

  beforeAll(async () => {
    fresh = await createEmptyDatabase();
    const migrated = await migrate(fresh);
    if (migrated.exitCode !== 0) throw new Error(`migrate failed:\n${migrated.output}`);
    db = await connect(fresh.applicationUrl);
    teacherUserId = await plantPendingTeacher(db, ENCRYPTION_KEY, recipientRef);
    database = openDatabase(fresh.applicationUrl, {
      poolMax: 2,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 30_000,
    });
    const route = createPaymentWebhookRoute({
      database,
      payment: createPaymentPort({ PAYMENT_GATEWAY: 'fake', ENCRYPTION_KEY }),
      log: createLogger({ level: 'info', destination: { write: (line) => void lines.push(line) } }),
      maxBodyBytes: 1_048_576,
      // Only recipient events are delivered here; a paid order event would be T038's.
      confirmations: { enqueue: () => Promise.reject(new Error('no order event is delivered')) },
    });
    server = createServer((request, response) => {
      const url = request.url ?? '/';
      if (url !== PAYMENT_WEBHOOK_PATH && !url.startsWith(`${PAYMENT_WEBHOOK_PATH}/`)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      request.url = url.slice(PAYMENT_WEBHOOK_PATH.length) || '/';
      route(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    await new Promise((resolve) =>
      server === undefined ? resolve(undefined) : server.close(resolve),
    );
    await database?.$disconnect();
    await db?.end();
    await fresh?.drop();
  });

  it('records the verdict once and leaves the verified instant of the first delivery', async () => {
    const env = {
      NODE_ENV: 'test',
      DATABASE_URL: fresh.applicationUrl,
      ENCRYPTION_KEY,
      PAYMENT_GATEWAY_WEBHOOK_SECRET: '',
    };
    const printed: string[] = [];
    const dependencies: RunDependencies = {
      connect: async (url) => connect(url),
      fetch,
      out: (line) => void printed.push(line),
      err: (line) => void printed.push(line),
    };
    const argv = ['--teacher', teacherUserId, '--verdict', 'verified', '--api', origin];

    const first = await run(argv, env, dependencies);
    // Any error the route logged is named here, so a failure shows its cause.
    expect(unexpectedErrors(lines)).toEqual([]);
    expect(first).toBe(0);
    const afterFirst = await stateOf(db, teacherUserId);

    const second = await run(argv, env, dependencies);

    expect(second).toBe(0);
    expect(await stateOf(db, teacherUserId)).toEqual(afterFirst);
    expect(afterFirst.events).toBe(1);
    expect(afterFirst.verifiedAt).not.toBeNull();
    expect(printed.join('\n')).not.toContain(recipientRef);
  });
});

/** The messages of the errors the route logged as unexpected. */
function unexpectedErrors(lines: readonly string[]): string[] {
  return lines
    .map((line) => JSON.parse(line) as { level?: string; err?: { message?: string } })
    .filter((record) => record.level === 'error')
    .map((record) => record.err?.message ?? '');
}

async function stateOf(db: pg.Client, teacherUserId: string) {
  const { rows } = await db.query<{ verified_at: Date | null; events: number }>(
    `SELECT payout_verified_at AS verified_at,
            (SELECT count(*)::int FROM payment_events) AS events
       FROM teacher_profiles WHERE user_id = $1`,
    [teacherUserId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the planted teacher is gone');
  return { verifiedAt: row.verified_at, events: row.events };
}

/**
 * An approved teacher whose payout is configured and not yet verified: the reference encrypted and
 * bound to the profile's row, with its lookup hash beside it (R-114), as registration leaves it.
 */
async function plantPendingTeacher(
  db: pg.Client,
  encryptionKey: string,
  recipientRef: string,
): Promise<string> {
  const userId = randomUUID();
  const profileId = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, gender, date_of_birth, display_name, preferred_language, timezone,
                        account_status, updated_at)
     VALUES ($1, $2, 'female', '1990-01-01', 'Teacher', 'ar', 'Africa/Cairo', 'active', now())`,
    [userId, `teacher-${userId}@example.com`],
  );
  await db.query(
    `INSERT INTO user_roles (user_id, role, status, updated_at) VALUES ($1, 'teacher', 'active', now())`,
    [userId],
  );
  const encrypted = new ColumnCipher(encryptionKey).encrypt(
    recipientRef,
    'teacher_profiles.payout_account_ref_encrypted',
    profileId,
  );
  await db.query(
    `INSERT INTO teacher_profiles (id, user_id, bio, qualification_summary, verification_status,
                                   approved_at, application_status, application_submitted_at,
                                   payout_account_ref_encrypted, payout_account_ref_hash,
                                   payout_configured_at, updated_at)
     VALUES ($1, $2, '', 'Hafs', 'approved', now(), 'approved', now(), $3, $4, now(), now())`,
    [profileId, userId, encrypted, payoutRefHash(recipientRef)],
  );
  return userId;
}
