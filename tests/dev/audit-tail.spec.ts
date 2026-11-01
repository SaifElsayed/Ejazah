// T087 — `scripts/dev/audit-tail.ts`, the newest audit entries with their stored label and, beside
// it, the target's name resolved now (quickstart §3, SC-108, FR-181): rename the teacher and the
// label stays while the resolved name changes. A person is resolved as the admin module resolves
// one (`labels/target-name.ts` over identity's `readTargetPerson`): the display name of a live row,
// the role of a deleted one, nothing for a type that names no person. Reads (`*.read`) are left out
// as every audit list leaves them out (owner's decision 2026-10-21). It only reads.
//
// The database case runs over the shared local database inside one transaction that is always
// rolled back (`tests/db-integrity/harness.ts`); its entries are dated far ahead so they are the
// newest whatever else the log holds.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuditTailRow,
  formatEntry,
  parseArguments,
  resolvedNameOf,
  run,
  type RunDependencies,
} from '../../scripts/dev/audit-tail';
import type { Connection } from '../../scripts/dev/local-only';
import {
  connectAsApplication,
  type Db,
  inRollback,
  insertRow,
  makeAdmin,
  makeUser,
} from '../db-integrity/harness';

const LOCAL = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://ijazah_app:secret@localhost:5432/ijazah',
};

describe('the command line (quickstart §3)', () => {
  it('reads how many of the newest entries to show', () => {
    expect(parseArguments(['--last', '10'])).toEqual({ last: 10 });
    expect(parseArguments(['--last', '1'])).toEqual({ last: 1 });
  });

  it.each([
    [[]],
    [['--last']],
    [['--last', '0']],
    [['--last', '-3']],
    [['--last', '2.5']],
    [['--last', 'ten']],
    [['--last', '100000']],
    [['--last', '10', '--email', 'a@example.com']],
  ])('refuses %j, saying how it is used', (argv) => {
    expect(parseArguments(argv)).toMatch(/usage/);
  });
});

const BASE: AuditTailRow = {
  occurredAt: new Date('2026-10-27T09:00:00Z'),
  action: 'applications.approve',
  targetType: 'teacher_application',
  targetLabel: 'طلب انضمام · 0193d1b0-7a4e-7c55-9d2f-3b1e8a6c4f21',
  personFound: true,
  personDeleted: false,
  personName: 'Teacher Name',
  personRole: 'teacher',
  adminName: null,
};

describe('the resolved name (as the admin pages resolve it)', () => {
  it('is a live person’s display name, for a person and for an application', () => {
    expect(resolvedNameOf(BASE)).toBe('Teacher Name');
    expect(resolvedNameOf({ ...BASE, targetType: 'user' })).toBe('Teacher Name');
  });

  it('is the role of a deleted person, never a name that no longer exists', () => {
    expect(resolvedNameOf({ ...BASE, personDeleted: true, personName: null })).toBe(
      '(deleted teacher)',
    );
    expect(
      resolvedNameOf({ ...BASE, personDeleted: true, personName: null, personRole: null }),
    ).toBe('(deleted user)');
  });

  it('is an administrator’s display name for an administrator', () => {
    expect(
      resolvedNameOf({ ...BASE, targetType: 'admin', personFound: false, adminName: 'Admin Two' }),
    ).toBe('Admin Two');
  });

  it('is nothing for a type that names no person, or a target not found', () => {
    for (const targetType of ['credential', 'document', 'verification_request', 'setting']) {
      expect(resolvedNameOf({ ...BASE, targetType, personFound: false })).toBe('—');
    }
    expect(resolvedNameOf({ ...BASE, personFound: false, personName: null })).toBe('—');
    expect(resolvedNameOf({ ...BASE, targetType: 'admin', personFound: false })).toBe('—');
  });
});

describe('the output', () => {
  it('is the instant, the action, the stored label and the name resolved now', () => {
    expect(formatEntry(BASE)).toBe(
      '2026-10-27T09:00:00.000Z  applications.approve  طلب انضمام · 0193d1b0-7a4e-7c55-9d2f-3b1e8a6c4f21  →  Teacher Name',
    );
  });
});

describe('the guard', () => {
  it('refuses before it reads anything: no database is opened', async () => {
    const connected: string[] = [];
    const errors: string[] = [];
    const code = await run(
      ['--last', '10'],
      { ...LOCAL, DATABASE_URL: 'postgresql://u:p@db.example.com/ijazah' },
      {
        connect: (url) => {
          connected.push(url);
          return Promise.reject(new Error('must not connect'));
        },
        out: () => undefined,
        err: (line) => void errors.push(line),
      },
    );

    expect(code).not.toBe(0);
    expect(connected).toEqual([]);
    expect(errors.join('\n')).toMatch(/DATABASE_URL/);
  });
});

// T124: skipped unless IJAZAH_DB_SPECS=1.
describe('over the local database (rolled back)', { tags: ['database'] }, () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  async function tail(last: number): Promise<string[]> {
    const printed: string[] = [];
    const connection: Connection = {
      query: (text, values) => db.query(text, values === undefined ? undefined : [...values]),
      end: async () => undefined,
    };
    const dependencies: RunDependencies = {
      connect: async () => connection,
      out: (line) => void printed.push(line),
      err: (line) => void printed.push(line),
    };
    expect(await run(['--last', String(last)], LOCAL, dependencies)).toBe(0);
    return printed;
  }

  it('shows the newest entries, reads left out, and the name follows a rename while the label stays', async () => {
    await inRollback(db, async () => {
      const adminId = await makeAdmin(db);
      const teacherId = await makeUser(db, { display_name: `Teacher ${randomUUID()}` });
      await insertRow(db, 'user_roles', { user_id: teacherId, role: 'teacher', status: 'active' });
      const label = `طلب انضمام · ${teacherId}`;
      const entry = (action: string, occurredAt: string) =>
        insertRow(db, 'audit_logs', {
          admin_id: adminId,
          action,
          target_type: 'teacher_application',
          target_id: teacherId,
          target_label: label,
          occurred_at: occurredAt,
        });
      await entry('applications.request_info', '2999-01-01T00:00:00Z');
      await entry('applications.approve', '2999-01-01T00:01:00Z');
      await entry('applications.read', '2999-01-01T00:02:00Z');

      const before = await tail(2);
      expect(before).toHaveLength(2);
      expect(before[0]).toContain('applications.approve');
      expect(before[1]).toContain('applications.request_info');
      expect(before.join('\n')).not.toContain('applications.read');
      const { rows } = await db.query<{ name: string }>(
        'SELECT display_name AS name FROM users WHERE id = $1',
        [teacherId],
      );
      for (const line of before) expect(line).toContain(`${label}  →  ${rows[0]?.name}`);

      await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [
        teacherId,
        'Renamed Teacher',
      ]);
      const after = await tail(2);
      for (const line of after) expect(line).toContain(`${label}  →  Renamed Teacher`);
    });
  });
});
