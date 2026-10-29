// T121 — the admin home's two queue cards count only what their lists show: a deleted account's
// application or pending credential is in neither list (`applicants.repository.ts`,
// `credential-review.repository.ts`), so neither card counts it, nor dates its oldest by it. Over a
// scripted client: what each read asks of the table, not Postgres (the table itself is probed in
// `tests/db-integrity/admin-home-queues.spec.ts`). T122: a banned account's credentials leave the
// documents queue's list and the card's count under one condition, with no write on them.
import { describe, expect, it, vi } from 'vitest';
import { credentialReviewStore, readCredentialQueue } from '../catalog/index.js';
import { readApplicationQueue } from '../identity/index.js';

type Where = { readonly where?: Readonly<Record<string, unknown>> };

describe("a banned account's credentials (T122)", () => {
  it('leave the documents queue and the card under one condition, written nowhere', async () => {
    const count = vi.fn(async (_: Where) => 0);
    const aggregate = vi.fn(async (_: Where) => ({ _min: { createdAt: null } }));
    const findMany = vi.fn(async (_: Where) => []);
    const updateMany = vi.fn(async (_: Where) => ({ count: 0 }));
    const tx = { teacherCredential: { count, aggregate, findMany, updateMany } } as never;
    await readCredentialQueue(tx);
    await credentialReviewStore.page(tx, { status: 'pending' }, 0, 10);
    await credentialReviewStore.count(tx, { status: 'pending' });
    const wheres = [...count.mock.calls, ...aggregate.mock.calls, ...findMany.mock.calls].map(
      ([query]) => query.where,
    );
    expect(wheres).toHaveLength(5);
    for (const where of wheres) {
      expect(where).toMatchObject({
        teacher: { deletedAt: null, accountStatus: { not: 'banned' } },
      });
    }
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('the home queue cards (T121)', () => {
  it('counts the credentials of live accounts only, as the credentials list does', async () => {
    const count = vi.fn(async (_: Where) => 0);
    const aggregate = vi.fn(async (_: Where) => ({ _min: { createdAt: null } }));
    await readCredentialQueue({ teacherCredential: { count, aggregate } } as never);
    const wheres = [...count.mock.calls, ...aggregate.mock.calls].map(([query]) => query.where);
    expect(wheres).toHaveLength(3);
    for (const where of wheres) expect(where).toMatchObject({ teacher: { deletedAt: null } });
  });

  it('counts the applications of live accounts only, as the applications list does', async () => {
    const count = vi.fn(async (_: Where) => 0);
    const aggregate = vi.fn(async (_: Where) => ({
      _count: { _all: 0 },
      _min: { applicationSubmittedAt: null },
    }));
    await readApplicationQueue({ teacherProfile: { count, aggregate } } as never);
    const wheres = [...count.mock.calls, ...aggregate.mock.calls].map(([query]) => query.where);
    expect(wheres).toHaveLength(2);
    for (const where of wheres) expect(where).toMatchObject({ user: { deletedAt: null } });
  });
});
