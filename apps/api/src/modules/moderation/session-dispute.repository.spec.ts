// T026 of specs/004-sessions (FR-473, FR-474, FR-495; research R-308) — the session dispute's two
// queries over a stand-in client, every branch: the insert answers the new id, null when the
// database refuses it by the one-open rule (rule 46, `disputes_one_open_per_session_key`) and any
// other refusal as it is thrown; the latest read asks nothing for no session, asks each session
// once, and answers each session's greatest id, a row with no session left out. What the database
// itself refuses is `tests/db-integrity/session-dispute.spec.ts`'.
//
// T034 and T059 (B39): the administrator's reads, the dispute's row lock and its closing update,
// every branch: the one read by id, the page of each group with and without a cursor, the session's
// disputes, and a row that breaks rule 46 (no session, or a complaint's resolution) thrown.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  closeSessionDispute,
  insertSessionDispute,
  latestSessionDisputesOf,
  lockDispute,
  type NewSessionDispute,
  sessionDisputeOf,
  type SessionDisputeResolution,
  type SessionDisputeRuling,
  sessionDisputesOfSession,
  sessionDisputesPage,
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

const ADMIN = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const OPENED = new Date('2026-11-01T10:00:00.000Z');
const RULED = new Date('2026-11-02T10:00:00.000Z');

/** The columns every administrator's read selects. */
const SELECTED = {
  id: true,
  enrollmentId: true,
  sessionId: true,
  raisedByUserId: true,
  reason: true,
  status: true,
  createdAt: true,
  resolution: true,
  resolutionNotes: true,
  resolvedAt: true,
};

interface Selected {
  id: string;
  enrollmentId: string;
  sessionId: string | null;
  raisedByUserId: string | null;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: Date;
  resolution: SessionDisputeResolution | 'enrollment_ended' | null;
  resolutionNotes: string | null;
  resolvedAt: Date | null;
}

const OPEN_ROW: Selected = {
  id: DISPUTE,
  enrollmentId: ENROLLMENT,
  sessionId: SESSION,
  raisedByUserId: RAISER,
  reason: 'لم يحضر المعلم',
  status: 'open',
  createdAt: OPENED,
  resolution: null,
  resolutionNotes: null,
  resolvedAt: null,
};

const RESOLVED_ROW: Selected = {
  ...OPEN_ROW,
  id: LATER,
  status: 'resolved',
  resolution: 're_marked',
  resolutionNotes: 'التسجيل يثبت الحضور',
  resolvedAt: RULED,
};

/**
 * A client whose reads answer `row` and `rows`, whose update moves `count` rows, and whose raw
 * query records its SQL.
 */
function adminClient({
  row = null,
  rows = [],
  count = 1,
}: { row?: Selected | null; rows?: readonly Selected[]; count?: number } = {}) {
  const asked: unknown[] = [];
  const stand = {
    dispute: {
      findFirst: async (args: unknown) => {
        asked.push(['findFirst', args]);
        return row;
      },
      findMany: async (args: unknown) => {
        asked.push(['findMany', args]);
        return rows;
      },
      updateMany: async (args: unknown) => {
        asked.push(['updateMany', args]);
        return { count };
      },
    },
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      asked.push(['$queryRaw', sql.join('?'), values]);
      return [];
    },
  };
  return { tx: stand as unknown as Transaction, asked };
}

const RULE_46 = 'moderation: a session dispute broke rule 46';

describe('sessionDisputeOf', () => {
  it('asks for the id of kind session_dispute and answers null for none', async () => {
    const { tx, asked } = adminClient();
    expect(await sessionDisputeOf(tx, DISPUTE)).toBeNull();
    expect(asked).toEqual([
      ['findFirst', { where: { id: DISPUTE, kind: 'session_dispute' }, select: SELECTED }],
    ]);
  });

  it('answers the dispute as it was selected', async () => {
    const { tx } = adminClient({ row: RESOLVED_ROW });
    expect(await sessionDisputeOf(tx, LATER)).toEqual(RESOLVED_ROW);
  });

  it('throws on a session dispute with no session (rule 46)', async () => {
    const { tx } = adminClient({ row: { ...OPEN_ROW, sessionId: null } });
    await expect(sessionDisputeOf(tx, DISPUTE)).rejects.toThrow(RULE_46);
  });

  it("throws on a session dispute carrying a complaint's resolution (rule 46)", async () => {
    const { tx } = adminClient({ row: { ...RESOLVED_ROW, resolution: 'enrollment_ended' } });
    await expect(sessionDisputeOf(tx, LATER)).rejects.toThrow(RULE_46);
  });
});

describe('sessionDisputesPage', () => {
  it('asks the open ones oldest first, with no cursor, at most the limit, and answers them', async () => {
    const { tx, asked } = adminClient({ rows: [OPEN_ROW] });
    expect(await sessionDisputesPage(tx, 'open', undefined, 20)).toEqual([OPEN_ROW]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { kind: 'session_dispute', status: 'open' },
          orderBy: { id: 'asc' },
          take: 20,
          select: SELECTED,
        },
      ],
    ]);
  });

  it('asks the open ones after the cursor, by a greater id', async () => {
    const { tx, asked } = adminClient();
    expect(await sessionDisputesPage(tx, 'open', DISPUTE, 5)).toEqual([]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { kind: 'session_dispute', status: 'open', id: { gt: DISPUTE } },
          orderBy: { id: 'asc' },
          take: 5,
          select: SELECTED,
        },
      ],
    ]);
  });

  it('asks the closed ones, resolved or dismissed, newest first, with no cursor', async () => {
    const dismissed: Selected = { ...OPEN_ROW, status: 'dismissed', resolvedAt: RULED };
    const { tx, asked } = adminClient({ rows: [RESOLVED_ROW, dismissed] });
    expect(await sessionDisputesPage(tx, 'closed', undefined, 20)).toEqual([
      RESOLVED_ROW,
      dismissed,
    ]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { kind: 'session_dispute', status: { in: ['resolved', 'dismissed'] } },
          orderBy: { id: 'desc' },
          take: 20,
          select: SELECTED,
        },
      ],
    ]);
  });

  it('asks the closed ones before the cursor, by a lesser id', async () => {
    const { tx, asked } = adminClient({ rows: [RESOLVED_ROW] });
    expect(await sessionDisputesPage(tx, 'closed', LATER, 1)).toEqual([RESOLVED_ROW]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: {
            kind: 'session_dispute',
            status: { in: ['resolved', 'dismissed'] },
            id: { lt: LATER },
          },
          orderBy: { id: 'desc' },
          take: 1,
          select: SELECTED,
        },
      ],
    ]);
  });

  it('throws when a row of the page breaks rule 46', async () => {
    const { tx } = adminClient({ rows: [OPEN_ROW, { ...OPEN_ROW, id: LATER, sessionId: null }] });
    await expect(sessionDisputesPage(tx, 'open', undefined, 20)).rejects.toThrow(RULE_46);
  });
});

describe('lockDispute', () => {
  it("locks the dispute's own row FOR UPDATE", async () => {
    const { tx, asked } = adminClient();
    await lockDispute(tx, DISPUTE);
    expect(asked).toEqual([
      [
        '$queryRaw',
        'SELECT 1 FROM disputes WHERE id = ANY(?::uuid[]) ORDER BY id FOR UPDATE',
        [[DISPUTE]],
      ],
    ]);
  });
});

describe('closeSessionDispute', () => {
  const RULING: SessionDisputeRuling = {
    disputeId: DISPUTE,
    resolution: 'compensation_ordered',
    notes: 'تعويض الطالب',
    adminId: ADMIN,
    resolvedAt: RULED,
  };

  it('closes it resolved where it is still open, in one conditional update, and answers true', async () => {
    const { tx, asked } = adminClient({ count: 1 });
    expect(await closeSessionDispute(tx, RULING)).toBe(true);
    expect(asked).toEqual([
      [
        'updateMany',
        {
          where: { id: DISPUTE, kind: 'session_dispute', status: 'open' },
          data: {
            status: 'resolved',
            resolution: 'compensation_ordered',
            resolutionNotes: 'تعويض الطالب',
            resolvedByAdminId: ADMIN,
            resolvedAt: RULED,
          },
        },
      ],
    ]);
  });

  it('answers false when no open dispute moved', async () => {
    const { tx } = adminClient({ count: 0 });
    expect(await closeSessionDispute(tx, RULING)).toBe(false);
  });
});

describe('sessionDisputesOfSession', () => {
  it("asks the session's session disputes oldest first and answers them", async () => {
    const { tx, asked } = adminClient({ rows: [OPEN_ROW, RESOLVED_ROW] });
    expect(await sessionDisputesOfSession(tx, SESSION)).toEqual([OPEN_ROW, RESOLVED_ROW]);
    expect(asked).toEqual([
      [
        'findMany',
        {
          where: { sessionId: SESSION, kind: 'session_dispute' },
          orderBy: { id: 'asc' },
          select: SELECTED,
        },
      ],
    ]);
  });

  it('throws when one of them breaks rule 46', async () => {
    const { tx } = adminClient({ rows: [{ ...RESOLVED_ROW, resolution: 'enrollment_ended' }] });
    await expect(sessionDisputesOfSession(tx, SESSION)).rejects.toThrow(RULE_46);
  });
});
