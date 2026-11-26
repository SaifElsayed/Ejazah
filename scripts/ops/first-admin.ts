// R2 T178 (`specs/002-identity/tasks.md` T178 and its R2 note; `specs/003-booking/tasks.md` T098
// item 3; SRS FR-ADMIN-1 as amended, DEC-108; ADR 0019 D3): the first administrator of a hosted
// server, and the recovery of an administrator who can no longer sign in. Run on the server by its
// owner, after `pnpm db:migrate` then `pnpm db:seed`, with the worker running:
//
//   pnpm exec tsx scripts/ops/first-admin.ts --email <x> --name <y>
//   pnpm exec tsx scripts/ops/first-admin.ts --recover --email <x> --reason <r>
//
// THE FIRST ADMINISTRATOR. Refused while any administrator `is_active AND password_set_at IS NOT
// NULL`, sign-in's own test (`admin-auth.service.ts`): a temporary lock still counts, and the seeded
// administrator, whose password is never set, never does. Otherwise it writes the row
// `AdminsService.add` writes, with SQL, as `scripts/dev/admin-invite.ts` does, because R-API-4 lets
// only the three composition files import the admin module. THE THREE WRITERS ARE ONE ROW, so A
// CHANGE TO ONE IS MADE TO ALL THREE: the address trimmed and lower-cased, a fresh second-factor
// secret encrypted to the row's id under `admin_users.mfa_secret_encrypted`, no password, active,
// invited now, and `invited_by_admin_id` NULL: no administrator invited it.
// `tests/ops/first-admin.spec.ts` and `tests/dev/admin-invite.spec.ts` fail when `admin_users`
// gains a column. An address another administrator holds is refused by the table's unique
// constraint. The refusal and the insert share one transaction but take no lock: two runs at once
// with two addresses may both add one, which is harmless (each is audited, each gets its invitation).
//
// --recover. The administrator by the trimmed, lower-cased address; an unknown or disabled one is
// refused. In one transaction: one UPDATE of that row, guarded by `is_active` (so a disabled
// administrator is refused by the statement itself, and nothing else of the run is written), clears the
// password and its date, the second factor's enrolment and last step, the lock and its count, gives
// a fresh encrypted secret and marks the invitation now; then the recovery codes are deleted and the
// open `admin_sessions` revoked, as `admins.resetMfa` does. The invitation link opens the panel's
// password page, then the second factor's setup and its new recovery codes. Irreversible for that
// administrator: the old password, factor and codes are gone.
//
// THE AUDIT ENTRY. `audit_logs.admin_id` is NOT NULL, and no administrator acts here, so each run's
// one entry names the seeded administrator (`prisma/seed.ts`'s `ADMINISTRATOR`), which stands for the
// platform as it does for every seeded setting (Q-4 (a)): `admin.bootstrap` with the reason
// «first-admin script», or `admin.recover` with the reason typed. Without the seeded row the script
// is refused: run `pnpm db:seed` first. Nothing locks that row; its foreign key refuses the entry,
// and so the run, if it went away meanwhile.
//
// THE INVITATION is only queued (`deliver-admin-invite { adminId }`), after the commit, so the job
// never runs before the row exists; the worker prepares the link from `ADMIN_PANEL_ORIGIN` and sends
// it through the email port's live sender. A queue that fails after the commit is said so, with the
// administrator's id: `--recover` on that address queues it again.
//
// It runs on the hosted server, so there is no `NODE_ENV` or `EMAIL_PROVIDER` guard. It reads the
// environment over `.env` as `scripts/dev/admin-invite.ts` does, writes through the application
// role's connection, and prints ids and reason codes only, never an address.
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { config as readDotenv } from 'dotenv';
import pg from 'pg';

import { DELIVER_ADMIN_INVITE } from '../../apps/api/src/jobs/deliver-admin-invite';
import { connectionFor, openQueue } from '../../apps/api/src/jobs/queue';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { generateTotpSecret } from '../../apps/api/src/platform/crypto/totp';
import { adminReason, adminsAddInput } from '../../packages/contracts/src/admin/admins';
import { ADMINISTRATOR, type Queryable } from '../../prisma/seed';

export type Env = Readonly<Record<string, string | undefined>>;

export const USAGE =
  'usage: pnpm exec tsx scripts/ops/first-admin.ts --email <x> --name <y> | --recover --email <x> --reason <r>';

/** The column the second-factor secret is encrypted under, bound to the row's id (R-DB-8). */
const MFA_SECRET_COLUMN = 'admin_users.mfa_secret_encrypted';

/** Postgres' unique_violation: the address is another administrator's. */
const UNIQUE_VIOLATION = '23505';

const CONNECT_TIMEOUT_MILLISECONDS = 5_000;

/** The reason the first administrator's entry carries (no one typed one). */
const BOOTSTRAP_REASON = 'first-admin script';

/**
 * The entry's target label, as `targetLabel('admin', id)` renders it in
 * `apps/api/src/modules/admin/labels/target-label.ts`: a copy, since R-API-4 keeps that module
 * closed to scripts. The kind word and the separator change there and here together.
 */
const adminTargetLabel = (adminId: string): string => `مشرف · ${adminId}`;

export type Command =
  | { readonly kind: 'bootstrap'; readonly email: string; readonly displayName: string }
  | { readonly kind: 'recover'; readonly email: string; readonly reason: string };

export type Refusal =
  | 'panel_origin_missing'
  | 'seed_missing'
  | 'administrator_can_sign_in'
  | 'email_taken'
  | 'administrator_unknown'
  | 'administrator_disabled';

const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  panel_origin_missing:
    'ADMIN_PANEL_ORIGIN is not set, so the worker has nowhere to point the invitation’s link',
  seed_missing:
    'the seeded administrator, the audit entry’s actor, is missing: run `pnpm db:seed` first',
  administrator_can_sign_in:
    'an active administrator who can sign in exists: add another from the panel, or use --recover',
  email_taken: 'another administrator already holds this address; nothing was written',
  administrator_unknown: 'no administrator holds this address; nothing was changed',
  administrator_disabled: 'this administrator is disabled; nothing was changed',
};

/** The arguments, read through the panel's own input contracts; null for anything else. */
export function commandOf(args: readonly string[]): Command | null {
  let values: {
    readonly email?: string | undefined;
    readonly name?: string | undefined;
    readonly reason?: string | undefined;
    readonly recover?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        email: { type: 'string' },
        name: { type: 'string' },
        reason: { type: 'string' },
        recover: { type: 'boolean' },
      },
      strict: true,
    }));
  } catch {
    return null;
  }
  if (values.recover === true) {
    if (values.name !== undefined) return null;
    const email = adminsAddInput.shape.email.safeParse(values.email);
    const reason = adminReason.safeParse(values.reason);
    return email.success && reason.success
      ? { kind: 'recover', email: email.data, reason: reason.data }
      : null;
  }
  if (values.reason !== undefined) return null;
  const admin = adminsAddInput.safeParse({ email: values.email, displayName: values.name });
  return admin.success
    ? { kind: 'bootstrap', email: admin.data.email, displayName: admin.data.displayName }
    : null;
}

/** Why the script will not run here, or null when it may. */
export function refusalOf(env: Env): Refusal | null {
  return env['ADMIN_PANEL_ORIGIN'] === undefined || env['ADMIN_PANEL_ORIGIN'] === ''
    ? 'panel_origin_missing'
    : null;
}

/** The one method of the queue the invitation needs. */
export interface InviteQueue {
  add(name: string, data: { readonly adminId: string }): Promise<unknown>;
}

export interface Dependencies {
  readonly db: Queryable;
  readonly cipher: Pick<ColumnCipher, 'encrypt'>;
  readonly queue: InviteQueue;
  /** The audit entry's actor: the seeded administrator unless a spec names an absent one. */
  readonly actorId?: string;
}

export type Outcome =
  | { readonly ok: true; readonly adminId: string; readonly queued: boolean }
  | { readonly ok: false; readonly refusal: Refusal };

const normalized = (email: string): string => email.trim().toLowerCase();

const refused = (refusal: Refusal): Outcome => ({ ok: false, refusal });

/** Runs `write` in one transaction; its refusal rolls everything back. */
async function inTransaction(
  db: Queryable,
  write: () => Promise<Refusal | string>,
): Promise<Refusal | { readonly adminId: string }> {
  await db.query('BEGIN');
  let result: Refusal | string;
  try {
    result = await write();
  } catch (error: unknown) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  if (isRefusal(result)) {
    await db.query('ROLLBACK');
    return result;
  }
  await db.query('COMMIT');
  return { adminId: result };
}

function isRefusal(value: string): value is Refusal {
  return Object.hasOwn(REFUSAL_TEXT, value);
}

async function seededAdministratorExists(db: Queryable, actorId: string): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM admin_users WHERE id = $1', [actorId]);
  return rows.length === 1;
}

async function audit(
  db: Queryable,
  actorId: string,
  action: 'admin.bootstrap' | 'admin.recover',
  adminId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (admin_id, action, target_type, target_id, target_label, reason)
     VALUES ($1, $2, 'admin', $3, $4, $5)`,
    [actorId, action, adminId, adminTargetLabel(adminId), reason],
  );
}

/** Queues the invitation once the row is committed; false when the queue failed. */
async function queueInvitation(queue: InviteQueue, adminId: string): Promise<boolean> {
  try {
    await queue.add(DELIVER_ADMIN_INVITE, { adminId });
    return true;
  } catch {
    return false;
  }
}

/** The first administrator: written, audited, and its invitation queued after the commit. */
export async function bootstrap(
  { db, cipher, queue, actorId = ADMINISTRATOR.id }: Dependencies,
  { email, displayName }: { readonly email: string; readonly displayName: string },
): Promise<Outcome> {
  const adminId = randomUUID();
  const written = await inTransaction(db, async () => {
    if (!(await seededAdministratorExists(db, actorId))) return 'seed_missing';
    const { rows } = await db.query(
      'SELECT 1 FROM admin_users WHERE is_active AND password_set_at IS NOT NULL LIMIT 1',
    );
    if (rows.length > 0) return 'administrator_can_sign_in';
    try {
      await db.query(
        `INSERT INTO admin_users
           (id, email, password_hash, mfa_secret_encrypted, display_name, is_active,
            invited_by_admin_id, invited_at, created_at, updated_at)
         VALUES ($1, $2, NULL, $3, $4, true, NULL, now(), now(), now())`,
        [
          adminId,
          normalized(email),
          cipher.encrypt(generateTotpSecret(), MFA_SECRET_COLUMN, adminId),
          displayName,
        ],
      );
    } catch (error: unknown) {
      if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return 'email_taken';
      throw error;
    }
    await audit(db, actorId, 'admin.bootstrap', adminId, BOOTSTRAP_REASON);
    return adminId;
  });
  if (typeof written === 'string') return refused(written);
  return { ok: true, adminId, queued: await queueInvitation(queue, adminId) };
}

/** An administrator who can no longer sign in, invited again: cleared, audited, queued. */
export async function recover(
  { db, cipher, queue, actorId = ADMINISTRATOR.id }: Dependencies,
  { email, reason }: { readonly email: string; readonly reason: string },
): Promise<Outcome> {
  const written = await inTransaction(db, async () => {
    if (!(await seededAdministratorExists(db, actorId))) return 'seed_missing';
    const found = await db.query<{ id: string }>('SELECT id FROM admin_users WHERE email = $1', [
      normalized(email),
    ]);
    const adminId = found.rows[0]?.id;
    if (adminId === undefined) return 'administrator_unknown';
    const { rowCount } = await db.query(
      `UPDATE admin_users
          SET password_hash = NULL, password_set_at = NULL,
              mfa_secret_encrypted = $2, mfa_enrolled_at = NULL, mfa_last_accepted_step = NULL,
              failed_sign_in_count = 0, locked_until_at = NULL,
              invited_at = now(), updated_at = now()
        WHERE id = $1 AND is_active`,
      [adminId, cipher.encrypt(generateTotpSecret(), MFA_SECRET_COLUMN, adminId)],
    );
    if (rowCount !== 1) return 'administrator_disabled';
    await db.query('DELETE FROM admin_recovery_codes WHERE admin_id = $1', [adminId]);
    await db.query(
      `UPDATE admin_sessions SET revoked_at = now(), updated_at = now()
        WHERE admin_id = $1 AND revoked_at IS NULL`,
      [adminId],
    );
    await audit(db, actorId, 'admin.recover', adminId, reason);
    return adminId;
  });
  if (typeof written === 'string') return refused(written);
  return {
    ok: true,
    adminId: written.adminId,
    queued: await queueInvitation(queue, written.adminId),
  };
}

/** Where `execute` writes: one line to stdout on success, one to stderr otherwise. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

/** Runs the command and says what happened, by id and reason code; the process's exit code. */
export async function execute(
  command: Command,
  deps: Dependencies,
  output: Output,
): Promise<number> {
  const outcome =
    command.kind === 'bootstrap' ? await bootstrap(deps, command) : await recover(deps, command);
  if (!outcome.ok) {
    output.err(`first-admin: refused (${outcome.refusal}): ${REFUSAL_TEXT[outcome.refusal]}`);
    return 1;
  }
  const action = command.kind === 'bootstrap' ? 'admin.bootstrap' : 'admin.recover';
  if (!outcome.queued) {
    output.err(
      `first-admin: failed (invitation_not_queued): administrator ${outcome.adminId} is written and audited (${action}), but the invitation could not be queued; once Redis answers, run --recover --email <x> --reason <r> for this administrator`,
    );
    return 1;
  }
  const done =
    command.kind === 'bootstrap'
      ? `administrator ${outcome.adminId} created and audited (${action})`
      : `administrator ${outcome.adminId} recovered and audited (${action}): password, second factor, recovery codes, lock and sessions cleared`;
  output.out(`first-admin: ${done}; the invitation goes out once the worker runs`);
  return 0;
}

/** An error by its code or name only: a message may carry an address or a connection string. */
function failureOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code !== '') return code;
  return error instanceof Error ? error.name : 'unknown';
}

async function main(): Promise<number> {
  const command = commandOf(process.argv.slice(2));
  if (command === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  const env: Env = { ...fromDotenv, ...process.env };
  const refusal = refusalOf(env);
  if (refusal !== null) {
    process.stderr.write(`first-admin: refused (${refusal}): ${REFUSAL_TEXT[refusal]}\n`);
    return 1;
  }
  const db = new pg.Client({
    connectionString: env['DATABASE_URL'],
    connectionTimeoutMillis: CONNECT_TIMEOUT_MILLISECONDS,
  });
  const queue = openQueue(connectionFor(env['REDIS_URL'] ?? ''));
  try {
    await db.connect();
    return await execute(
      command,
      { db, cipher: new ColumnCipher(env['ENCRYPTION_KEY'] ?? ''), queue },
      {
        out: (line) => void process.stdout.write(`${line}\n`),
        err: (line) => void process.stderr.write(`${line}\n`),
      },
    );
  } catch (error: unknown) {
    process.stderr.write(`first-admin: failed (${failureOf(error)}); nothing was committed\n`);
    return 1;
  } finally {
    await db.end().catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'first-admin.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
