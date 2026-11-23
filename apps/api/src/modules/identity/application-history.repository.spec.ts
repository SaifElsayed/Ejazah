// R1a (002:T174; SRS DEC-97, FR-AUTH-14; ERD §2 `teacher_application_history`, §15 rules 67 and 69;
// the owner's Q-2 (a) of 2026-11-22). The application's history as identity writes, reads and erases
// it, over a scripted client: what the repository asks of the tables, not Postgres (the real queries
// and the database's refusals are `tests/db-integrity/teacher-application-history.spec.ts`'s).
// `record` resolves the profile the caller already holds and inserts one row, reading no `users` and
// taking no lock; `listOf` reads oldest first with the administrator's name; `eraseOf` deletes only a
// teacher never approved and refuses one once approved, deleting nothing. Last, the source of
// `apps/api/src` deletes from the table nowhere but inside `eraseOf`.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { eraseOf, listOf, record, recordWithId } from './application-history.repository.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';
const PROFILE = '0199d0a0-0000-7000-8000-0000000000f1';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const AT = new Date('2026-11-22T10:00:00Z');

type Client = Parameters<typeof record>[0];

/** A client with only the two delegates; any other table (`users`) or a raw lock is not there. */
function clientOf(profile: { id: string; approvedAt: Date | null } | null, rows: unknown[] = []) {
  const findUnique = vi.fn(async () => profile);
  const create = vi.fn(async () => ({ id: 'row' }));
  const findMany = vi.fn(async () => rows);
  const deleteMany = vi.fn(async () => ({ count: rows.length }));
  const client = {
    teacherProfile: { findUnique },
    teacherApplicationHistory: { create, findMany, deleteMany },
  } as unknown as Client;
  return { client, findUnique, create, findMany, deleteMany };
}

async function thrown(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('record', () => {
  it('inserts one row on the profile the caller holds, with the decision, its note, the administrator and its instant', async () => {
    const { client, findUnique, create } = clientOf({ id: PROFILE, approvedAt: null });
    await record(client, {
      teacherUserId: TEACHER,
      action: 'request_info',
      note: 'صورة الهوية غير واضحة',
      adminId: ADMIN,
      at: AT,
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: TEACHER }, select: { id: true } });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        teacherProfileId: PROFILE,
        action: 'request_info',
        note: 'صورة الهوية غير واضحة',
        adminId: ADMIN,
        createdAt: AT,
      },
      select: { id: true },
    });
  });

  // R1b round 2 (002:T186, the owner's «موافق» of 2026-11-23): `recordCall`'s audit entry names the
  // `call_replaced` row by its id, so `recordWithId` inserts as `record` does and answers the id.
  it("recordWithId inserts the same row and answers the inserted row's id", async () => {
    const { client, create } = clientOf({ id: PROFILE, approvedAt: null });
    expect(
      await recordWithId(client, {
        teacherUserId: TEACHER,
        action: 'call_replaced',
        note: 'تحقّقت من الهوية',
        adminId: ADMIN,
        at: AT,
      }),
    ).toBe('row');
    expect(create).toHaveBeenCalledWith({
      data: {
        teacherProfileId: PROFILE,
        action: 'call_replaced',
        note: 'تحقّقت من الهوية',
        adminId: ADMIN,
        createdAt: AT,
      },
      select: { id: true },
    });
  });

  it('writes an approval with no note as null', async () => {
    const { client, create } = clientOf({ id: PROFILE, approvedAt: null });
    await record(client, {
      teacherUserId: TEACHER,
      action: 'approve',
      note: null,
      adminId: ADMIN,
      at: AT,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'approve', note: null }) }),
    );
  });

  it('throws for a person with no profile, inserting nothing', async () => {
    const { client, create } = clientOf(null);
    expect(
      await thrown(
        record(client, {
          teacherUserId: TEACHER,
          action: 'reject',
          note: 'سبب',
          adminId: ADMIN,
          at: AT,
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('listOf', () => {
  it('reads the profile’s rows oldest first, each with the administrator’s name', async () => {
    const older = new Date('2026-11-20T09:00:00Z');
    const { client, findMany } = clientOf({ id: PROFILE, approvedAt: null }, [
      {
        action: 'request_info',
        note: 'أرسل صورة أوضح',
        createdAt: older,
        admin: { displayName: 'أ. سعاد' },
      },
      { action: 'approve', note: null, createdAt: AT, admin: { displayName: 'أ. خالد' } },
    ]);
    expect(await listOf(client, TEACHER)).toEqual([
      { action: 'request_info', note: 'أرسل صورة أوضح', adminName: 'أ. سعاد', at: older },
      { action: 'approve', note: null, adminName: 'أ. خالد', at: AT },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { teacherProfile: { userId: TEACHER } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        action: true,
        note: true,
        createdAt: true,
        admin: { select: { displayName: true } },
      },
    });
  });
});

describe('eraseOf (Q-2 (a): the erasure alone deletes, and never a teacher once approved)', () => {
  it('deletes the rows of a teacher never approved and answers how many', async () => {
    const { client, findUnique, deleteMany } = clientOf({ id: PROFILE, approvedAt: null }, [
      {},
      {},
    ]);
    expect(await eraseOf(client, TEACHER)).toBe(2);
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: TEACHER },
      select: { id: true, approvedAt: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { teacherProfileId: PROFILE } });
  });

  it('refuses a teacher once approved, throwing and deleting nothing', async () => {
    const { client, deleteMany } = clientOf(
      { id: PROFILE, approvedAt: new Date('2026-10-01T09:00:00Z') },
      [{}],
    );
    expect(await thrown(eraseOf(client, TEACHER))).toBeInstanceOf(Error);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes nothing for a person with no profile', async () => {
    const { client, deleteMany } = clientOf(null);
    expect(await eraseOf(client, TEACHER)).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('no other delete path (rule 69, Q-2 (a))', () => {
  const SOURCE = fileURLToPath(new URL('../../', import.meta.url));
  const HERE = 'modules/identity/application-history.repository.ts';
  const DELETES = [
    /teacherApplicationHistory\s*\.\s*delete(?:Many)?\b/g,
    /DELETE\s+FROM\s+"?teacher_application_history"?/gi,
    // A delete through a parent's relation (PR #157's review, round 1, Minor 1): the profile's or
    // the administrator's `applicationHistory`.
    /\bapplicationHistory\s*:\s*\{[^}]*\bdelete(?:Many)?\b/g,
  ];

  async function sourcesUnder(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourcesUnder(path);
        return Promise.resolve(
          entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [],
        );
      }),
    );
    return nested.flat();
  }

  it('finds a delete of the table only inside `eraseOf`', async () => {
    const files = await sourcesUnder(SOURCE);
    const found: { file: string; index: number }[] = [];
    const texts = new Map<string, string>();
    for (const file of files) {
      const text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
      const name = relative(SOURCE, file).replaceAll('\\', '/');
      texts.set(name, text);
      for (const pattern of DELETES) {
        for (const match of text.matchAll(pattern)) found.push({ file: name, index: match.index });
      }
    }
    expect(found.length).toBeGreaterThan(0);
    const own = texts.get(HERE) ?? '';
    const start = own.indexOf('export async function eraseOf(');
    const end = own.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(-1);
    for (const { file, index } of found) {
      expect({ file, insideEraseOf: file === HERE && index > start && index < end }).toEqual({
        file: HERE,
        insideEraseOf: true,
      });
    }
  });
});
