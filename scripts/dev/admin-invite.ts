// B12b (T066's note, owner's decision 2026-10-21): gives the seeded administrator a password through
// the invite job's own path, on a development machine only.
//
//   pnpm exec tsx scripts/dev/admin-invite.ts
//
// The seed writes the administrator with an unusable password and no invitation (prisma/seed.ts).
// This marks the invitation now (`invited_at`), where no password was ever set and the account is
// active, and queues `deliver-admin-invite` with the id alone, as `admins.add` does; the running
// worker prepares the link and hands the mail to the email port, whose stand-in writes it under
// `<STORAGE_LOCAL_ROOT>/mail/`. The link opens the panel's password page, then the second factor's
// setup. Run it again after the link's lifetime (`admin_invite_ttl_hours`) for a fresh one.
//
// IT NEVER SENDS A REAL MAIL. It refuses unless `NODE_ENV` is `development` and the email provider
// is the stand-in, and refuses without `ADMIN_PANEL_ORIGIN`, which the link needs (the worker would
// fail the delivery). Like the seed, it writes through the application role's connection.
import { basename } from 'node:path';

import { config as readDotenv } from 'dotenv';
import pg from 'pg';

import { DELIVER_ADMIN_INVITE } from '../../apps/api/src/jobs/deliver-admin-invite';
import { connectionFor, openQueue } from '../../apps/api/src/jobs/queue';
import { ADMINISTRATOR, type Queryable } from '../../prisma/seed';

/** The email provider that writes mail to a folder and sends nothing (contracts/ports.md). */
const STAND_IN_EMAIL = 'fake';

/** Why the script will not run here, or null when it may. */
export function refusalOf(env: Readonly<Record<string, string | undefined>>): string | null {
  if (env['NODE_ENV'] !== 'development') {
    return 'runs only where NODE_ENV is development';
  }
  if ((env['EMAIL_PROVIDER'] ?? STAND_IN_EMAIL) !== STAND_IN_EMAIL) {
    return `runs only with the stand-in email provider (EMAIL_PROVIDER=${STAND_IN_EMAIL}), so no real mail is sent`;
  }
  if (env['ADMIN_PANEL_ORIGIN'] === undefined || env['ADMIN_PANEL_ORIGIN'] === '') {
    return 'ADMIN_PANEL_ORIGIN is not set, so the link has nowhere to point (.env.example)';
  }
  return null;
}

/** The one method of the queue the invite needs. */
export interface InviteQueue {
  add(name: string, data: { readonly adminId: string }): Promise<unknown>;
}

/**
 * Marks the seeded administrator invited now and queues the invite; false, and nothing queued, when
 * the administrator already set a password or is disabled.
 */
export async function inviteSeededAdministrator(
  db: Queryable,
  queue: InviteQueue,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE admin_users
        SET invited_at = now(), updated_at = now()
      WHERE id = $1 AND password_set_at IS NULL AND is_active`,
    [ADMINISTRATOR.id],
  );
  if (rowCount !== 1) return false;
  await queue.add(DELIVER_ADMIN_INVITE, { adminId: ADMINISTRATOR.id });
  return true;
}

async function main(): Promise<number> {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  const env = { ...fromDotenv, ...process.env };
  const refusal = refusalOf(env);
  if (refusal !== null) {
    process.stderr.write(`admin-invite: ${refusal}\n`);
    return 1;
  }
  const db = new pg.Client({
    connectionString: env['DATABASE_URL'],
    connectionTimeoutMillis: 5_000,
  });
  const queue = openQueue(connectionFor(env['REDIS_URL'] ?? ''));
  try {
    await db.connect();
    if (!(await inviteSeededAdministrator(db, queue))) {
      process.stderr.write(
        `admin-invite: ${ADMINISTRATOR.email} already has a password, or is disabled; nothing was queued\n`,
      );
      return 1;
    }
  } finally {
    await db.end().catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
  process.stdout.write(
    `admin-invite: queued for ${ADMINISTRATOR.email}; with the worker running, the mail is under <STORAGE_LOCAL_ROOT>/mail/\n`,
  );
  return 0;
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'admin-invite.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
