// T026 of specs/004-sessions (FR-473, FR-474, FR-495; research R-308) — the session dispute's two
// queries over a stand-in client, every branch: the insert answers the new id, null when the
// database refuses it by the one-open rule (rule 46, `disputes_one_open_per_session_key`) and any
// other refusal as it is thrown; the latest read asks nothing for no session, asks each session
// once, and answers each session's greatest id, a row with no session left out. What the database
// itself refuses is `tests/db-integrity/session-dispute.spec.ts`'.
import { describe, expect, it } from 'vitest';

import {
  insertSessionDispute,
  latestSessionDisputesOf,
  type NewSessionDispute,
} from './session-dispute.repository.js';

const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const LATER = '0199d0a0-0000-7000-8000-0000000000d2';
const SESSION = '0199d0a0-0000-7000-8000-0000000000a1';
const OTHER = '0199d0a0-0000-7000-8000-0000000000a2';
const RAISER = '0199d0a0-0000-7000-8000-0000000000c1';

const NEW: NewSessionDispute = {
  enrollmentId: '0199d0a0-0000-7000-8000-0000000000e1',
  sessionId: SESSION,
  raisedByUserId: RAISER,
  reason: 'لم يحضر المعلم',
};

/** The adapter's refusal by the unique index `index`, as `db-errors.ts` reads it. */
function uniqueRefusal(index: string) {
  return {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '23505',
      originalMessage: `duplicate key value violates unique constraint "${index}"`,
      constraint: { index },
    },
  };
}

type Client = Parameters<typeof insertSessionDispute>[0];

/** A client whose `dispute.create` answers `create` and whose `findMany` answers `rows`. */
function client({
  create = async () => ({ id: DISPUTE }),
  rows = [],
}: {
  create?: (args: unknown) => Promise<{ id: string }>;
  rows?: readonly {
    id: string;
    sessionId: string | null;
    status: 'open' | 'resolved' | 'dismissed';
    raisedByUserId: string | null;
  }[];
} = {}) {
  const asked: unknown[] = [];
  const stand = {
    dispute: {
      create: async (args: unknown) => {
        asked.push(['create', args]);
        return create(args);
      },
      findMany: async (args: unknown) => {
        asked.push(['findMany', args]);
        return rows;
      },
    },
  };
  return { tx: stand as unknown as Client, asked };
}

describe('insertSessionDispute', () => {
  it('opens the session dispute and answers its id', async () => {
    const { tx, asked } = client();
    expect(await insertSessionDispute(tx, NEW)).toBe(DISPUTE);
    expect(asked).toEqual([
      [
        'create',
        {
          data: { ...NEW, kind: 'session_dispute', status: 'open' },
          select: { id: true },
        },
      ],
    ]);
  });

  it('answers null when one is already open (rule 46)', async () => {
    const { tx } = client({
      create: () => Promise.reject(uniqueRefusal('disputes_one_open_per_session_key')),
    });
    expect(await insertSessionDispute(tx, NEW)).toBeNull();
  });

  it('throws any other refusal as it is', async () => {
    const other = uniqueRefusal('disputes_one_open_complaint_per_enrollment_key');
    const { tx } = client({ create: () => Promise.reject(other) });
    await expect(insertSessionDispute(tx, NEW)).rejects.toBe(other);
  });
});

describe('latestSessionDisputesOf', () => {
  it('asks nothing for no session', async () => {
    const { tx, asked } = client();
    expect((await latestSessionDisputesOf(tx, [])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('asks each session once and answers its greatest id, open or closed, a row with no session left out', async () => {
    const { tx, asked } = client({
      rows: [
        { id: LATER, sessionId: SESSION, status: 'open', raisedByUserId: RAISER },
        { id: DISPUTE, sessionId: SESSION, status: 'resolved', raisedByUserId: RAISER },
        { id: DISPUTE, sessionId: null, status: 'open', raisedByUserId: null },
        { id: DISPUTE, sessionId: OTHER, status: 'dismissed', raisedByUserId: null },
      ],
    });
    const latest = await latestSessionDisputesOf(tx, [SESSION, OTHER, SESSION]);
    expect(Object.fromEntries(latest)).toEqual({
      [SESSION]: { disputeId: LATER, status: 'open', raisedByUserId: RAISER },
      [OTHER]: { disputeId: DISPUTE, status: 'dismissed', raisedByUserId: null },
    });
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { sessionId: { in: [SESSION, OTHER] }, kind: 'session_dispute' },
          orderBy: [{ sessionId: 'asc' }, { id: 'desc' }],
          select: { id: true, sessionId: true, status: true, raisedByUserId: true },
        },
      ],
    ]);
  });
});
