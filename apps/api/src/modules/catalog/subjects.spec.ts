// T038 — `catalog.subjects.list` (FR-182, ADR 0021 D1; app-surface.md "`platform` and `catalog`").
//
// The active subjects with both names, for the application form, the subject picker and the home
// chips. The repository is the catalog module's own, apart from `catalog.repository.ts` (which
// serves discovery and stays under the gender suite gate, T163); the service is the one rule
// holder; the router is thin and public, counting the client address under
// `rate_limit_public_page`. The repository is exercised over a recorded client: what it asks of
// the table (active rows, both names, a stable order) is asserted, not Postgres.
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { createLogger } from '../../platform/logging/logger.js';
import { PUBLIC_PAGE_RATE_LIMIT } from '../../platform/web/route.js';
import { type AppServices, createAppContext } from '../../surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../surfaces/procedures.js';
import { createSubjectsService, subjectsRouter, type SubjectsReader } from './index.js';
import { SubjectsRepository } from './subjects.repository.js';

const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const CLIENT = '203.0.113.9';

const rows = [
  { id: '01a1231c-0000-7000-8000-000000000101', nameAr: 'القرآن الكريم', nameEn: "Qur'an" },
  { id: '01a1231c-0000-7000-8000-000000000102', nameAr: 'التجويد', nameEn: 'Tajweed' },
];

describe('the subjects repository (T038)', () => {
  it('asks the table for the active rows, both names and the id, in creation order', async () => {
    const findMany = vi.fn(async () => rows);
    const database = { subject: { findMany } } as unknown as Pick<Database, 'subject'>;
    await expect(new SubjectsRepository(database).listActive()).resolves.toEqual(rows);
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, nameAr: true, nameEn: true },
    });
  });
});

describe('the subjects service (T038)', () => {
  it('lists what the repository lists, nothing added and nothing dropped', async () => {
    const database = {
      subject: { findMany: async () => rows },
    } as unknown as Pick<Database, 'subject'>;
    const service: SubjectsReader = createSubjectsService(database);
    await expect(service.listActive()).resolves.toEqual(rows);
  });
});

describe('catalog.subjects.list (T038, FR-182)', () => {
  function fixture() {
    const check = vi.fn(async () => undefined);
    const rateLimiter = { check } as unknown as RateLimiter;
    const services: AppServices = {
      settings: {
        read: async () => {
          throw new Error('no setting is read here');
        },
      },
      publicConfig: { supportEmail: 'support@ijazah.invalid' },
      subjects: { listActive: async () => rows },
    };
    const router = createAppRouter({ catalog: createAppRouter({ subjects: subjectsRouter }) });
    const caller = createAppCallerFactory(router)(
      createAppContext({ session: null, log, rateLimiter, clientAddress: CLIENT, services }),
    );
    return { caller, check, router };
  }

  it('answers the active subjects with both names to an anonymous caller', async () => {
    const { caller } = fixture();
    await expect(caller.catalog.subjects.list()).resolves.toEqual(rows);
  });

  it('counts the client address under rate_limit_public_page (T170)', async () => {
    const { caller, check, router } = fixture();
    await caller.catalog.subjects.list();
    expect(check).toHaveBeenCalledWith(PUBLIC_PAGE_RATE_LIMIT, CLIENT);
    const procedures = router._def.procedures as unknown as Record<
      string,
      { _def: { meta?: { surface: string; rateLimit?: string } } }
    >;
    const procedure = procedures['catalog.subjects.list'];
    expect(procedure?._def.meta).toEqual({ surface: 'app', rateLimit: PUBLIC_PAGE_RATE_LIMIT });
  });
});
