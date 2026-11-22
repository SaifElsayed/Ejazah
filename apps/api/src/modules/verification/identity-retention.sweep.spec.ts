// R1a, `specs/002-identity/tasks.md` T176 (SRS §3.14, DEC-100, DEC-67, NFR-COMP-2; the note under
// T176, Q-3 (a); contracts/kernel.md of specs/004-sessions, the document sweep's row and "Jobs") —
// what the daily `erase-identity-documents` runs, verification's, over a recorded store (the real
// tables are `tests/db-integrity/identity-retention.spec.ts`'). Written before the sweep, and run
// red first on a stub; each refusal also shown red by a named mutant (C1-1 to C1-5).
//
// An identity document on a live account is marked erased (`erased_at`, its key kept, so the hourly
// `erase-deleted-files` removes the file) once `identity_document_retention_days` have passed since
// its decision: a rejected or banned application's (`application_decided_at`; a ban never before
// `ban_restore_window_days` has passed too), a satisfied or replaced identity request's
// (`resolved_at`). Never a document of a teacher once approved (DEC-67), never one an open matter
// holds, never one already erased or kept. Each document on its own transaction under the account's,
// the application's and the document's locks, read again there; one bad row never stops the rest.
// ⚠️ Automatic: once the hourly job removes the file there is no way back.
import { addDays, addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import { runOnceAndTwice } from '../../jobs/double-run.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  createIdentityRetentionSweep,
  type IdentityRetentionStore,
  type RetainedApplication,
  type RetainedRequest,
  type RetentionCutoffs,
} from './identity-retention.sweep.js';

const NOW = new Date('2026-11-22T04:40:00.000Z');
const daysAgo = (days: number) => new Date(addDays(NOW, -days));

const user = (n: number) => `0199d0a0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
const doc = (n: number) => `0199d0a0-0000-7000-8000-0000000002${String(n).padStart(2, '0')}`;
const req = (n: number) => `0199d0a0-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`;
const profile = (n: number) => `0199d0a0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

interface Doc {
  userId: string;
  erasedAt: Date | null;
  keptAt: Date | null;
}

interface World {
  readonly documents: Map<string, Doc>;
  /** By user id: the application its profile holds. */
  readonly applications: Map<string, RetainedApplication & { readonly profileId: string }>;
  /** By document id: the identity request that holds it. */
  readonly requests: Map<string, RetainedRequest & { readonly requestId: string }>;
  readonly approved: Set<string>;
  readonly held: Set<string>;
  readonly lines: { level: string; entry: object }[];
  readonly reported: Error[];
  readonly locks: string[];
  readonly cutoffs: RetentionCutoffs[];
  settings: Record<string, unknown>;
  transactions: number;
  failing?: string;
  onLock?: (userId: string) => void;
}

function emptyWorld(): World {
  return {
    documents: new Map(),
    applications: new Map(),
    requests: new Map(),
    approved: new Set(),
    held: new Set(),
    lines: [],
    reported: [],
    locks: [],
    cutoffs: [],
    settings: { identity_document_retention_days: 90, ban_restore_window_days: 14 },
    transactions: 0,
  };
}

/** An applicant `n` whose profile points at document `n`, decided `days` ago with `status`. */
function applicant(
  w: World,
  n: number,
  status: RetainedApplication['status'],
  days: number,
  options: { approved?: boolean; at?: Date } = {},
): void {
  w.documents.set(doc(n), { userId: user(n), erasedAt: null, keptAt: null });
  w.applications.set(user(n), {
    profileId: profile(n),
    status,
    decidedAt: options.at ?? daysAgo(days),
    identityDocumentId: doc(n),
  });
  if (options.approved === true) w.approved.add(user(n));
}

/** A person `n` whose identity request `n` holds document `n`, closed `days` ago with `status`. */
function requester(
  w: World,
  n: number,
  status: RetainedRequest['status'],
  days: number,
  options: { approved?: boolean } = {},
): void {
  w.documents.set(doc(n), { userId: user(n), erasedAt: null, keptAt: null });
  w.requests.set(doc(n), {
    requestId: req(n),
    userId: user(n),
    status,
    resolvedAt: status === 'open' ? null : daysAgo(days),
  });
  if (options.approved === true) w.approved.add(user(n));
}

const lte = (a: Date | null, b: Date) => a !== null && a.getTime() <= b.getTime();

function storeOver(w: World): IdentityRetentionStore {
  return {
    // As identity's entry: rejected or banned, never approved, decided by the cutoffs. The page is
    // read with no lock, so a spec may list what the read under the locks must refuse (`approved`).
    applicationsDue: async (_tx, cutoffs, after, limit) => {
      w.cutoffs.push(cutoffs);
      return [...w.applications.entries()]
        .filter(
          ([, a]) =>
            a.identityDocumentId !== null &&
            ((a.status === 'rejected' && lte(a.decidedAt, cutoffs.decidedBefore)) ||
              (a.status === 'banned' && lte(a.decidedAt, cutoffs.bannedBefore))),
        )
        .map(([userId, a]) => ({
          cursor: a.profileId,
          userId,
          documentId: a.identityDocumentId as string,
        }))
        .filter(({ cursor }) => after === undefined || cursor > after)
        .sort((a, b) => a.cursor.localeCompare(b.cursor))
        .slice(0, limit);
    },
    requestsDue: async (_tx, decidedBefore, after, limit) =>
      [...w.requests.entries()]
        .filter(
          ([documentId, r]) =>
            (r.status === 'satisfied' || r.status === 'replaced') &&
            lte(r.resolvedAt, decidedBefore) &&
            w.documents.get(documentId)?.erasedAt === null,
        )
        .map(([documentId, r]) => ({ cursor: r.requestId, userId: r.userId, documentId }))
        .filter(({ cursor }) => after === undefined || cursor > after)
        .sort((a, b) => a.cursor.localeCompare(b.cursor))
        .slice(0, limit),
    lockAccount: async (_tx, userId) => {
      w.locks.push(`users:${userId}`);
      w.onLock?.(userId);
    },
    lockApplication: async (_tx, userId) => void w.locks.push(`teacher_profiles:${userId}`),
    lockDocument: async (_tx, documentId) =>
      void w.locks.push(`verification_documents:${documentId}`),
    everApproved: async (_tx, userId) => w.approved.has(userId),
    applicationOf: async (_tx, userId) => {
      if (w.failing === userId) throw new Error('spec: unreachable');
      const a = w.applications.get(userId);
      return a === undefined
        ? null
        : { status: a.status, decidedAt: a.decidedAt, identityDocumentId: a.identityDocumentId };
    },
    requestHolding: async (_tx, documentId) => {
      const r = w.requests.get(documentId);
      if (r === undefined) return null;
      if (w.failing === r.userId) throw new Error('spec: unreachable');
      return { userId: r.userId, status: r.status, resolvedAt: r.resolvedAt };
    },
    documentOf: async (_tx, documentId) => {
      const d = w.documents.get(documentId);
      return d === undefined ? null : { ...d };
    },
    // Unconditional here, so the sweep's own read under the locks is what refuses an erased or kept
    // document; the real update's `WHERE` (C1-5) is the database spec's.
    markErased: async (_tx, documentId, at) => {
      const d = w.documents.get(documentId);
      if (d === undefined) return false;
      d.erasedAt = at;
      return true;
    },
  };
}

function sweepOver(w: World, pageSize = 10) {
  const transactions: Transactions = {
    run: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
      w.transactions += 1;
      return work({} as Transaction);
    },
  };
  const settings: Pick<SettingsReader, 'read'> = {
    read: async (key, schema) => {
      if (!Object.hasOwn(w.settings, key)) throw new SettingError(key, 'missing');
      return schema.parse(w.settings[key]);
    },
  };
  return createIdentityRetentionSweep({
    transactions,
    settings,
    held: async (userIds) => new Set(userIds.filter((id) => w.held.has(id))),
    log: {
      info: (entry: object) => void w.lines.push({ level: 'info', entry }),
      error: (entry: object) => void w.lines.push({ level: 'error', entry }),
    },
    pageSize,
    report: (error) => void w.reported.push(error),
    clock: async () => NOW,
    store: storeOver(w),
  });
}

const erasedOf = (w: World) =>
  [...w.documents.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, d]) => [id, d.erasedAt?.toISOString() ?? null]);

const ERASED = NOW.toISOString();

describe('erase-identity-documents: a teacher once approved keeps the identity document (DEC-67) ⚠️', () => {
  it('leaves an approved teacher’s identity document untouched on day 91, also after a reapplication rejected (C1-1)', async () => {
    const w = emptyWorld();
    // Approved, revoked, reapplied and rejected again: `approved_at` is never cleared.
    applicant(w, 1, 'rejected', 91, { approved: true });
    // Approved, then banned as a teacher: the application keeps its status, the ban its instant.
    applicant(w, 2, 'banned', 200, { approved: true });
    // An approved teacher's satisfied identity request.
    requester(w, 3, 'satisfied', 91, { approved: true });
    expect(await sweepOver(w).run()).toEqual({ erased: [], failed: [] });
    expect(erasedOf(w)).toEqual([
      [doc(1), null],
      [doc(2), null],
      [doc(3), null],
    ]);
    expect(w.lines).toEqual([]);
  });
});

describe('erase-identity-documents: a rejected applicant’s identity document (SRS §3.14, 90 days)', () => {
  it('is marked on day 91 and not on day 89', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    applicant(w, 2, 'rejected', 89);
    expect(await sweepOver(w).run()).toEqual({ erased: [doc(1)], failed: [] });
    expect(erasedOf(w)).toEqual([
      [doc(1), ERASED],
      [doc(2), null],
    ]);
  });

  it('is marked at exactly 90 days and not one second before (C1-2)', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 0, { at: daysAgo(90) });
    applicant(w, 2, 'rejected', 0, { at: new Date(addSeconds(daysAgo(90), 1)) });
    expect(await sweepOver(w).run()).toEqual({ erased: [doc(1)], failed: [] });
  });

  it('judges the days again under the locks: a decision made again meanwhile, 89 days ago, waits (C1-2)', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    applicant(w, 2, 'rejected', 91);
    // Listed by the page at 91 days; under the locks one decision reads 89 days old, one exactly 90.
    w.onLock = (userId) => {
      const a = w.applications.get(userId);
      const at = userId === user(1) ? daysAgo(89) : daysAgo(90);
      if (a !== undefined) w.applications.set(userId, { ...a, decidedAt: at });
    };
    expect(await sweepOver(w).run()).toEqual({ erased: [doc(2)], failed: [] });
  });

  it('reads the days from the setting on every run', async () => {
    const w = emptyWorld();
    w.settings['identity_document_retention_days'] = 30;
    applicant(w, 1, 'rejected', 31);
    applicant(w, 2, 'rejected', 29);
    expect((await sweepOver(w).run()).erased).toEqual([doc(1)]);
    expect(w.cutoffs[0]?.decidedBefore).toEqual(daysAgo(30));
  });

  it('never counts an open application: in review or waiting on a document', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'in_review', 120);
    applicant(w, 2, 'needs_document', 120);
    // Listed by a page read before a reapplication moved it back to review: refused under the locks.
    w.onLock = (userId) => {
      const a = w.applications.get(userId);
      if (a !== undefined) w.applications.set(userId, { ...a, status: 'in_review' });
    };
    applicant(w, 3, 'rejected', 120);
    expect(await sweepOver(w).run()).toEqual({ erased: [], failed: [] });
  });

  it('leaves a document the profile no longer points at, read again under the locks', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 120);
    w.onLock = (userId) => {
      const a = w.applications.get(userId);
      if (a !== undefined) w.applications.set(userId, { ...a, identityDocumentId: doc(9) });
    };
    expect((await sweepOver(w).run()).erased).toEqual([]);
  });
});

describe('erase-identity-documents: a banned applicant (Q-3 (a)), never inside the restore window', () => {
  it('is not marked inside the restore window, and is marked after both it and the retention (C1-3)', async () => {
    const w = emptyWorld();
    w.settings['identity_document_retention_days'] = 10;
    applicant(w, 1, 'banned', 12);
    applicant(w, 2, 'banned', 15);
    applicant(w, 3, 'rejected', 12);
    expect(await sweepOver(w).run()).toEqual({ erased: [doc(2), doc(3)], failed: [] });
    expect(w.cutoffs[0]).toEqual({ decidedBefore: daysAgo(10), bannedBefore: daysAgo(14) });
  });

  it('at the defaults: marked on day 91, not on day 89', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'banned', 91);
    applicant(w, 2, 'banned', 89);
    expect((await sweepOver(w).run()).erased).toEqual([doc(1)]);
    expect(w.cutoffs[0]).toEqual({ decidedBefore: daysAgo(90), bannedBefore: daysAgo(90) });
  });
});

describe('erase-identity-documents: a decided identity request’s document', () => {
  it('marks a satisfied and a replaced request’s document on day 91, never an open or expired one', async () => {
    const w = emptyWorld();
    requester(w, 1, 'satisfied', 91);
    requester(w, 2, 'replaced', 91);
    requester(w, 3, 'satisfied', 89);
    requester(w, 4, 'open', 0);
    requester(w, 5, 'expired', 120);
    expect(await sweepOver(w).run()).toEqual({ erased: [doc(1), doc(2)], failed: [] });
  });

  it('leaves a document whose request, read again under the locks, is no longer satisfied or replaced', async () => {
    const w = emptyWorld();
    requester(w, 1, 'satisfied', 91);
    requester(w, 2, 'satisfied', 91);
    // Staged under the locks: each status but the two, its closing instant left in place.
    w.onLock = (userId) => {
      const r = w.requests.get(userId === user(1) ? doc(1) : doc(2));
      const status = userId === user(1) ? 'open' : 'expired';
      if (r !== undefined) w.requests.set(userId === user(1) ? doc(1) : doc(2), { ...r, status });
    };
    expect((await sweepOver(w).run()).erased).toEqual([]);
  });
});

describe('erase-identity-documents: what is never marked, and how', () => {
  it('skips a document an open matter holds (C1-4)', async () => {
    const w = emptyWorld();
    requester(w, 1, 'satisfied', 91);
    requester(w, 2, 'satisfied', 91);
    w.held.add(user(1));
    expect(await sweepOver(w).run()).toEqual({ erased: [doc(2)], failed: [] });
  });

  it('skips a document already erased or kept, read again under the locks', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    applicant(w, 2, 'rejected', 91);
    w.onLock = (userId) => {
      if (userId === user(1)) (w.documents.get(doc(1)) as Doc).erasedAt = daysAgo(1);
      if (userId === user(2)) (w.documents.get(doc(2)) as Doc).keptAt = daysAgo(1);
    };
    expect(await sweepOver(w).run()).toEqual({ erased: [], failed: [] });
  });

  it('takes the account, then the application, then the document, before reading them again', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    requester(w, 2, 'satisfied', 91);
    await sweepOver(w).run();
    expect(w.locks).toEqual([
      `users:${user(1)}`,
      `teacher_profiles:${user(1)}`,
      `verification_documents:${doc(1)}`,
      `users:${user(2)}`,
      `teacher_profiles:${user(2)}`,
      `verification_documents:${doc(2)}`,
    ]);
  });

  it('writes one info line per document, ids and a reason code only', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    applicant(w, 2, 'banned', 91);
    requester(w, 3, 'satisfied', 91);
    requester(w, 4, 'replaced', 91);
    await sweepOver(w).run();
    expect(w.lines).toEqual([
      {
        level: 'info',
        entry: { documentId: doc(1), userId: user(1), reason: 'application_rejected' },
      },
      {
        level: 'info',
        entry: { documentId: doc(2), userId: user(2), reason: 'application_banned' },
      },
      {
        level: 'info',
        entry: { documentId: doc(3), userId: user(3), reason: 'request_satisfied' },
      },
      { level: 'info', entry: { documentId: doc(4), userId: user(4), reason: 'request_replaced' } },
    ]);
  });

  it('catches one document’s failure on its own, logs its ids and reports it, and goes on', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    applicant(w, 2, 'rejected', 91);
    requester(w, 3, 'satisfied', 91);
    requester(w, 4, 'satisfied', 91);
    w.failing = user(1);
    const run = await sweepOver(w).run();
    w.failing = user(3);
    const second = await sweepOver(w).run();
    expect(run).toEqual({ erased: [doc(2), doc(3), doc(4)], failed: [doc(1)] });
    expect(second).toEqual({ erased: [doc(1)], failed: [] });
    expect(w.lines).toContainEqual({
      level: 'error',
      entry: { documentId: doc(1), userId: user(1) },
    });
    expect(w.reported).toHaveLength(1);
  });

  it('reads the candidates a page at a time, each on its own transaction', async () => {
    const w = emptyWorld();
    applicant(w, 1, 'rejected', 91);
    applicant(w, 2, 'rejected', 91);
    applicant(w, 3, 'rejected', 91);
    requester(w, 4, 'satisfied', 91);
    requester(w, 5, 'satisfied', 91);
    expect((await sweepOver(w, 2).run()).erased).toEqual([doc(1), doc(2), doc(3), doc(4), doc(5)]);
    // The run's clock; the applications' pages ([1, 2], [3]) and the requests' ([4, 5], []); one
    // transaction per document.
    expect(w.transactions).toBe(1 + 2 + 2 + 5);
  });

  it('run twice, leaves what one run leaves (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => {
        const w = emptyWorld();
        applicant(w, 1, 'rejected', 91);
        applicant(w, 2, 'banned', 91);
        applicant(w, 3, 'rejected', 89);
        requester(w, 4, 'satisfied', 91);
        requester(w, 5, 'replaced', 91, { approved: true });
        return w;
      },
      run: async (w) => {
        await sweepOver(w).run();
      },
      observe: (w) => ({ erased: erasedOf(w), lines: w.lines }),
    });
    expect(twice).toEqual(once);
  });
});
