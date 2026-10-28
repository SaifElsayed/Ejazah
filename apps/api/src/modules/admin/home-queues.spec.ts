// T121 — the admin home's two queue cards count only what their lists show: a deleted account's
// application or pending credential is in neither list (`applicants.repository.ts`,
// `credential-review.repository.ts`), so neither card counts it, nor dates its oldest by it. Over a
// scripted client: what each read asks of the table, not Postgres (the table itself is probed in
// `tests/db-integrity/admin-home-queues.spec.ts`).
import { describe, expect, it, vi } from 'vitest';
import { readCredentialQueue } from '../catalog/index.js';
import { readApplicationQueue } from '../identity/index.js';

type Where = { readonly where?: Readonly<Record<string, unknown>> };

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
