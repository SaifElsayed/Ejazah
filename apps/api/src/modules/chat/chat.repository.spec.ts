// T037 of specs/004-sessions — the chat's queries over a recorded client (R-API-6, R-SEC-3,
// R-DB-9). What a unit spec can show: a page is keyset on the message id, newest first, on the
// enrollment's rows only, and selects an attachment's name and type but never its storage key; a
// send inserts the text and answers the same columns; the sender's lock is one `users` row `FOR
// UPDATE` through the kernel's `lockRows`. The same queries over the real tables run in the
// adversarial suite's chat attacks (`tests/adversarial/chat.attacks.ts`).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { insertMessage, lockSender, messagePage } from './chat.repository.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-11T10:00:00Z');

/** What every query of the chat selects: never `attachmentKey`. */
const COLUMNS = {
  id: true,
  senderUserId: true,
  body: true,
  attachmentFilename: true,
  attachmentMime: true,
  sentAt: true,
  purgedAt: true,
};

/** A client that records each call and answers `answer`. */
function recorded(answer: unknown = []) {
  const calls: { method: string; args: unknown }[] = [];
  const tx = {
    chatMessage: {
      findMany: async (args: unknown) => {
        calls.push({ method: 'findMany', args });
        return answer;
      },
      create: async (args: unknown) => {
        calls.push({ method: 'create', args });
        return answer;
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ method: '$queryRaw', args: { sql: strings.join('?'), values } });
      return [];
    },
  };
  return { calls, tx: tx as unknown as Transaction };
}

describe('the chat queries (T037)', () => {
  it('reads the first page newest first by id, on the enrollment only, never the key', async () => {
    const { calls, tx } = recorded();
    await messagePage(tx, { enrollmentId: id(1), take: 51 });
    expect(calls).toEqual([
      {
        method: 'findMany',
        args: {
          where: { enrollmentId: id(1) },
          orderBy: { id: 'desc' },
          take: 51,
          select: COLUMNS,
        },
      },
    ]);
  });

  it('reads a later page before the cursor', async () => {
    const { calls, tx } = recorded();
    await messagePage(tx, { enrollmentId: id(1), before: id(9), take: 51 });
    expect(calls).toEqual([
      {
        method: 'findMany',
        args: {
          where: { enrollmentId: id(1), id: { lt: id(9) } },
          orderBy: { id: 'desc' },
          take: 51,
          select: COLUMNS,
        },
      },
    ]);
  });

  it('inserts the text and answers the same columns', async () => {
    const row = { id: id(7) };
    const { calls, tx } = recorded(row);
    const sent = { enrollmentId: id(1), senderUserId: id(2), body: 'سلام', sentAt: AT };
    await expect(insertMessage(tx, sent)).resolves.toBe(row);
    expect(calls).toEqual([{ method: 'create', args: { data: sent, select: COLUMNS } }]);
  });

  it("locks the sender's users row FOR UPDATE, one statement", async () => {
    const { calls, tx } = recorded();
    await lockSender(tx, id(2));
    expect(calls).toHaveLength(1);
    const [call] = calls as [{ method: string; args: { sql: string; values: unknown[] } }];
    expect(call.method).toBe('$queryRaw');
    expect(call.args.sql).toMatch(/FROM users WHERE id = ANY\(.*FOR UPDATE/);
    expect(call.args.values).toEqual([[id(2)]]);
  });
});
