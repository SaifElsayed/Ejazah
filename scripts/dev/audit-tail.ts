// T087 (SC-108, FR-180, FR-181; quickstart §3): the newest audit entries, each with the label its
// writer stored and, beside it, the target's name resolved now. Rename a teacher and read the tail
// again: the labels stay, the names beside them change.
//
//   pnpm exec tsx scripts/dev/audit-tail.ts --last 10
//
// THE NAME is resolved as the admin module resolves it for its pages (`labels/target-name.ts`, over
// identity's `readTargetPerson`): for a person or an application, the account's display name, or
// its role once the row is deleted; for an administrator, the administrator's display name; for a
// type that names no person, nothing. The admin module may be imported by its three composition
// files only (R-API-4), so this reads the rows directly, in one query, and prints the role in
// English where the panel shows its Arabic word. Reads (`*.read`) are left out, as every audit list
// leaves them out (owner's decision 2026-10-21, T065).
//
// IT ONLY READS, ONLY ON THIS MACHINE (note under T087): the guard of `local-only.ts` refuses before
// the database is opened, and the session is read-only, so the database refuses any write. The
// names it prints are what the panel shows beside each entry.
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import {
  connectReadOnly,
  type Connection,
  type Env,
  environment,
  lineWriter,
  localOnlyRefusal,
} from './local-only';

/** The most entries one call shows, so the read stays bounded. */
const MOST_ENTRIES = 500;
const USAGE = `usage: audit-tail.ts --last <1..${MOST_ENTRIES}>`;
const WHOLE = /^[1-9][0-9]*$/;

/** The target types that name an account, resolved through `users` (identity's `readTargetPerson`). */
const PERSON_TYPES: ReadonlySet<string> = new Set(['user', 'teacher_application']);
const ADMIN_TYPE = 'admin';
const NO_NAME = '—';

/** The arguments, or the usage line saying what is wrong with them. */
export function parseArguments(argv: readonly string[]): { readonly last: number } | string {
  let values: { last?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { last: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return USAGE;
  }
  const last = values.last === undefined || !WHOLE.test(values.last) ? NaN : Number(values.last);
  if (!(last >= 1 && last <= MOST_ENTRIES)) return `${USAGE}\n  --last is a whole number`;
  return { last };
}

/** One entry as the tail reads it: the stored label, and what the name is resolved from. */
export interface AuditTailRow {
  readonly occurredAt: Date;
  readonly action: string;
  readonly targetType: string;
  readonly targetLabel: string;
  /** A row of `users` with the target's id exists, deleted or not. */
  readonly personFound: boolean;
  readonly personDeleted: boolean;
  readonly personName: string | null;
  readonly personRole: string | null;
  /** The administrator's display name, for an `admin` target. */
  readonly adminName: string | null;
}

/** The newest entries, reads left out, each with its target's person or administrator. */
const AUDIT_TAIL = `
  SELECT entry.occurred_at AS "occurredAt",
         entry.action,
         entry.target_type AS "targetType",
         entry.target_label AS "targetLabel",
         person.id IS NOT NULL AS "personFound",
         person.deleted_at IS NOT NULL AS "personDeleted",
         person.display_name AS "personName",
         person_role.role::text AS "personRole",
         target_admin.display_name AS "adminName"
    FROM (SELECT *
            FROM audit_logs
           WHERE action NOT LIKE '%.read'
           ORDER BY occurred_at DESC, id DESC
           LIMIT $1) entry
    LEFT JOIN users person
      ON entry.target_type = ANY($2::text[]) AND person.id::text = entry.target_id
    LEFT JOIN user_roles person_role ON person_role.user_id = person.id
    LEFT JOIN admin_users target_admin
      ON entry.target_type = $3 AND target_admin.id::text = entry.target_id
   ORDER BY entry.occurred_at DESC, entry.id DESC`;

/** The target's name now, as the admin pages show it beside the label. */
export function resolvedNameOf(row: AuditTailRow): string {
  if (row.targetType === ADMIN_TYPE) return row.adminName ?? NO_NAME;
  if (!PERSON_TYPES.has(row.targetType) || !row.personFound) return NO_NAME;
  if (row.personDeleted || row.personName === null) return `(deleted ${row.personRole ?? 'user'})`;
  return row.personName;
}

/** One line: the instant, the action, the stored label and the name resolved now. */
export function formatEntry(row: AuditTailRow): string {
  return `${row.occurredAt.toISOString()}  ${row.action}  ${row.targetLabel}  →  ${resolvedNameOf(row)}`;
}

export interface RunDependencies {
  readonly connect: (url: string) => Promise<Connection>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Prints the tail; the process's exit code. */
export async function run(
  argv: readonly string[],
  env: Env,
  deps: RunDependencies,
): Promise<number> {
  const say = (line: string): void => deps.err(`audit-tail: ${line}`);
  const parsed = parseArguments(argv);
  if (typeof parsed === 'string') {
    say(parsed);
    return 2;
  }
  const refusal = localOnlyRefusal(env);
  if (refusal !== null) {
    say(refusal);
    return 1;
  }
  const db = await deps.connect(env['DATABASE_URL'] ?? '');
  try {
    const { rows } = await db.query<AuditTailRow>(AUDIT_TAIL, [
      parsed.last,
      [...PERSON_TYPES],
      ADMIN_TYPE,
    ]);
    for (const row of rows) deps.out(formatEntry(row));
  } finally {
    await db.end().catch(() => undefined);
  }
  return 0;
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'audit-tail.ts') {
  void run(process.argv.slice(2), environment(), {
    connect: connectReadOnly,
    out: lineWriter(process.stdout),
    err: lineWriter(process.stderr),
  }).then((code) => {
    process.exitCode = code;
  });
}
