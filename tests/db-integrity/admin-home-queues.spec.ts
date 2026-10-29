// T065 — the admin home's two queue cards over the real tables, as the admin module reads them
// through the identity and catalog modules' entries (`readApplicationQueue`, `readCredentialQueue`;
// R-API-6, FR-176), a deleted account left out as the lists leave it (T121), and a banned
// account's credential too (T122). A count is over the
// whole table, which other probes fill while this one runs, so each probe reads inside one
// REPEATABLE READ transaction: it counts, writes its own rows through the owning modules' entries
// on that transaction, counts again and rolls everything back. The
// snapshot is the transaction's, so the difference is exactly its own rows. The parents the entries
// need (a person, a document) are committed first, as every probe here writes them.
//
// Not probed: `waitingOnApplicant`, the applications needing a document. No entry moves an
// application to `needs_document` before the admin's request for one (T068), and a row committed
// for it would be counted by both reads; its filter is the one beside `in_review`.
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addCredential, readCredentialQueue } from '../../apps/api/src/modules/catalog/index.js';
import { readApplicationQueue, setApplication } from '../../apps/api/src/modules/identity/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { connectAsApplication, type Db, insertRow, makeSubject, makeUser } from './harness';

let db: Db;
let database: Database;

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await db.end();
  await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one REPEATABLE READ snapshot and rolls back whatever it wrote. */
async function onOneSnapshot<T>(probe: (tx: Transaction) => Promise<T>): Promise<T> {
  let answer: { readonly value: T } | undefined;
  try {
    await database.$transaction(
      async (tx) => {
        answer = { value: await probe(tx) };
        throw ROLLED_BACK;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
  if (answer === undefined) throw new Error('the probe answered nothing');
  return answer.value;
}

/** A committed person with a committed document of `type`, for an entry to point at. */
async function personWithDocument(type: 'national_id' | 'credential') {
  const userId = await makeUser(db);
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: type,
    storage_key_encrypted: Buffer.from('probe'),
  });
  return { userId, documentId };
}

describe('the applications card', () => {
  it('counts the applications in review and answers the oldest submission among them', async () => {
    const first = await personWithDocument('national_id');
    const second = await personWithDocument('national_id');
    // Older than any application another probe opens, so it is the oldest on the snapshot.
    const oldest = new Date('1971-01-01T00:00:00Z');
    const [before, after] = await onOneSnapshot(async (tx) => {
      const counted = await readApplicationQueue(tx);
      for (const [person, submittedAt] of [
        [first, oldest],
        [second, new Date('2026-10-20T09:00:00Z')],
      ] as const) {
        const opened = await setApplication(tx, person.userId, {
          kind: 'open',
          from: null,
          qualificationSummary: 'Probe summary',
          identityDocumentId: person.documentId,
          identityDocumentType: 'national_id',
          submittedAt,
        });
        expect(opened).toBe(true);
      }
      return [counted, await readApplicationQueue(tx)] as const;
    });
    expect(after.open - before.open).toBe(2);
    expect(after.oldestSubmittedAt).toEqual(oldest);
    expect(after.waitingOnApplicant).toBe(before.waitingOnApplicant);
  });

  it("leaves out a deleted account's application, as the applications list does (T121)", async () => {
    const person = await personWithDocument('national_id');
    const [before, after] = await onOneSnapshot(async (tx) => {
      const counted = await readApplicationQueue(tx);
      await setApplication(tx, person.userId, {
        kind: 'open',
        from: null,
        qualificationSummary: 'Probe summary',
        identityDocumentId: person.documentId,
        identityDocumentType: 'national_id',
        submittedAt: new Date('1970-06-01T00:00:00Z'),
      });
      await tx.user.update({ where: { id: person.userId }, data: { deletedAt: new Date() } });
      return [counted, await readApplicationQueue(tx)] as const;
    });
    expect(after).toEqual(before);
  });
});

describe('the credentials card', () => {
  it('counts the pending credentials, and those of them for a subject added after approval', async () => {
    const teacher = await personWithDocument('credential');
    const another = await insertRow(db, 'verification_documents', {
      user_id: teacher.userId,
      document_type: 'credential',
      storage_key_encrypted: Buffer.from('probe'),
    });
    const subjects = [await makeSubject(db), await makeSubject(db)];
    const [before, after] = await onOneSnapshot(async (tx) => {
      const counted = await readCredentialQueue(tx);
      const createdAt = new Date('2026-10-20T09:00:00Z');
      await addCredential(tx, {
        teacherUserId: teacher.userId,
        subjectId: subjects[0] ?? randomUUID(),
        documentId: teacher.documentId,
        submittedWithApplication: true,
        createdAt,
      });
      await addCredential(tx, {
        teacherUserId: teacher.userId,
        subjectId: subjects[1] ?? randomUUID(),
        documentId: another,
        submittedWithApplication: false,
        createdAt,
      });
      return [counted, await readCredentialQueue(tx)] as const;
    });
    expect(after.open - before.open).toBe(2);
    expect(after.addedSubjects - before.addedSubjects).toBe(1);
    // The oldest pending credential's moment, for the card's age (B14d): none later than these two.
    expect(after.oldestSubmittedAt).toBeInstanceOf(Date);
    expect(after.oldestSubmittedAt?.getTime()).toBeLessThanOrEqual(
      Date.parse('2026-10-20T09:00:00Z'),
    );
  });

  it("leaves out a deleted account's credential, as the credentials list does (T121)", async () => {
    const teacher = await personWithDocument('credential');
    const subject = await makeSubject(db);
    const [before, after] = await onOneSnapshot(async (tx) => {
      const counted = await readCredentialQueue(tx);
      await addCredential(tx, {
        teacherUserId: teacher.userId,
        subjectId: subject,
        documentId: teacher.documentId,
        submittedWithApplication: false,
        createdAt: new Date('1970-06-01T00:00:00Z'),
      });
      await tx.user.update({ where: { id: teacher.userId }, data: { deletedAt: new Date() } });
      return [counted, await readCredentialQueue(tx)] as const;
    });
    expect(after).toEqual(before);
  });

  it("leaves out a banned account's credential, as the credentials list does (T122)", async () => {
    const teacher = await personWithDocument('credential');
    const subject = await makeSubject(db);
    const [before, after] = await onOneSnapshot(async (tx) => {
      const counted = await readCredentialQueue(tx);
      await addCredential(tx, {
        teacherUserId: teacher.userId,
        subjectId: subject,
        documentId: teacher.documentId,
        submittedWithApplication: false,
        createdAt: new Date('1970-06-01T00:00:00Z'),
      });
      await tx.user.update({
        where: { id: teacher.userId },
        data: { accountStatus: 'banned' },
      });
      return [counted, await readCredentialQueue(tx)] as const;
    });
    expect(after).toEqual(before);
  });
});
