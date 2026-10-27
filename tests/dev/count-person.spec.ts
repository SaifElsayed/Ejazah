// T087 — `scripts/dev/count-person.ts`, the rows of one person across every table (quickstart §2
// and §5, SC-103, SC-111). The tables are read from the database itself: every table holding a
// foreign key to `users(id)`, and `users`, so a table added later is counted with no edit here or
// there. An address is looked up as the identity module stores it (trimmed, lower case, in a
// `citext` column). It prints table and count, never a personal value, and only reads.
//
// The database cases run over the shared local database inside one transaction that is always
// rolled back (`tests/db-integrity/harness.ts`), so nothing they plant outlives them.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  countStatements,
  formatCounts,
  parseArguments,
  REFERENCES_TO_USERS,
  run,
  type RunDependencies,
} from '../../scripts/dev/count-person';
import type { Connection } from '../../scripts/dev/local-only';
import {
  connectAsApplication,
  type Db,
  inRollback,
  insertRow,
  makeUser,
} from '../db-integrity/harness';

const LOCAL = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://ijazah_app:secret@localhost:5432/ijazah',
};

describe('the command line (quickstart §2, §5)', () => {
  const user = randomUUID();

  it('reads an address or a user id, one of the two', () => {
    expect(parseArguments(['--email', 'Someone@Example.com'])).toEqual({
      email: 'Someone@Example.com',
    });
    expect(parseArguments(['--user', user])).toEqual({ user });
  });

  it.each([
    [[]],
    [['--email', 'a@example.com', '--user', randomUUID()]],
    [['--user', 'not-a-uuid']],
    [['--email', '   ']],
    [['--email']],
    [['--last', '10']],
    [['someone@example.com']],
  ])('refuses %j, saying how it is used', (argv) => {
    expect(parseArguments(argv)).toMatch(/usage/);
  });
});

describe('the tables (derived, never listed)', () => {
  it('counts `users` by its id and every referencing table by each of its columns', () => {
    const statements = countStatements([
      { table: 'user_roles', column: 'user_id' },
      { table: 'enrollments', column: 'student_user_id' },
      { table: 'enrollments', column: 'teacher_user_id' },
    ]);

    expect(statements.map(({ table }) => table)).toEqual(['enrollments', 'user_roles', 'users']);
    expect(statements.find(({ table }) => table === 'enrollments')?.text).toBe(
      'SELECT count(*)::int AS rows FROM "enrollments" WHERE "student_user_id" = ANY($1::uuid[]) OR "teacher_user_id" = ANY($1::uuid[])',
    );
    expect(statements.find(({ table }) => table === 'users')?.text).toBe(
      'SELECT count(*)::int AS rows FROM "users" WHERE "id" = ANY($1::uuid[])',
    );
  });

  it('quotes every name it is handed as an identifier', () => {
    const [statement] = countStatements([{ table: 'odd"table', column: 'odd"column' }]);
    expect(statement?.text).toContain('FROM "odd""table" WHERE "odd""column" = ANY');
  });
});

describe('the output', () => {
  it('is one line per table with its count, and the person’s ids, never a personal value', () => {
    const lines = formatCounts(
      ['0193d1b0-7a4e-7c55-9d2f-3b1e8a6c4f21'],
      [
        { table: 'users', rows: 1 },
        { table: 'auth_identities', rows: 0 },
      ],
    );
    expect(lines).toEqual([
      'users matched: 1 (0193d1b0-7a4e-7c55-9d2f-3b1e8a6c4f21)',
      'auth_identities  0',
      'users            1',
      'total            1',
    ]);
  });

  it('says so when nobody matched', () => {
    expect(formatCounts([], [{ table: 'users', rows: 0 }])[0]).toBe('users matched: 0');
  });
});

describe('the guard', () => {
  it('refuses before it reads anything: no database is opened', async () => {
    const connected: string[] = [];
    const errors: string[] = [];
    const code = await run(
      ['--user', randomUUID()],
      { ...LOCAL, NODE_ENV: 'production' },
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
    expect(errors.join('\n')).toMatch(/NODE_ENV/);
  });
});

describe('over the local database (rolled back)', () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectAsApplication();
  });
  afterAll(async () => {
    await db.end();
  });

  /** The script's run over the case's own transaction, which it never ends. */
  async function counted(argv: readonly string[]): Promise<{ code: number; printed: string }> {
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
    const code = await run(argv, LOCAL, dependencies);
    return { code, printed: printed.join('\n') };
  }

  /** The count printed beside `table`, or undefined when the table is not listed. */
  function countOf(printed: string, table: string): number | undefined {
    const line = printed
      .split('\n')
      .slice(1)
      .find((candidate) => candidate.split(/\s+/)[0] === table);
    return line === undefined ? undefined : Number(line.split(/\s+/)[1]);
  }

  it('counts one person by id and by address, the address in any case and spacing', async () => {
    await inRollback(db, async () => {
      const address = `probe-${randomUUID()}@example.invalid`;
      const userId = await makeUser(db, { email: address, display_name: 'Probe Person' });
      await insertRow(db, 'user_roles', { user_id: userId, role: 'student', status: 'active' });
      await insertRow(db, 'terms_acceptances', { user_id: userId, terms_version: '2026-10' });

      for (const argv of [
        ['--user', userId],
        ['--email', `  ${address.toUpperCase()} `],
      ]) {
        const { code, printed } = await counted(argv);
        expect(code).toBe(0);
        expect(printed).toContain(`users matched: 1 (${userId})`);
        expect(countOf(printed, 'users')).toBe(1);
        expect(countOf(printed, 'user_roles')).toBe(1);
        expect(countOf(printed, 'terms_acceptances')).toBe(1);
        // Tables of later phases are listed because their keys reference users, not by name here.
        for (const table of ['auth_identities', 'user_sessions', 'enrollments', 'reviews']) {
          expect(countOf(printed, table)).toBe(0);
        }
        expect(countOf(printed, 'total')).toBe(3);
        expect(printed).not.toContain(address);
        expect(printed.toLowerCase()).not.toContain(address.toLowerCase());
        expect(printed).not.toContain('Probe Person');
      }
    });
  });

  it('prints zero in every table for an address nobody holds (quickstart §2, abandoned sign-up)', async () => {
    const { code, printed } = await counted(['--email', `nobody-${randomUUID()}@example.invalid`]);
    expect(code).toBe(0);
    expect(printed).toContain('users matched: 0');
    expect(countOf(printed, 'users')).toBe(0);
    expect(countOf(printed, 'total')).toBe(0);
  });

  it('lists exactly the tables whose foreign keys reference users, and users', async () => {
    const { rows } = await db.query<{ table: string }>(REFERENCES_TO_USERS);
    const { printed } = await counted(['--user', randomUUID()]);
    const listed = printed
      .split('\n')
      .slice(1, -1)
      .map((line) => line.split(/\s+/)[0]);
    expect(new Set(listed)).toEqual(new Set([...rows.map(({ table }) => table), 'users']));
  });
});
