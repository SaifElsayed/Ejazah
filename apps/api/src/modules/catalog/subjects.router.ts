// T038: `catalog.subjects.list` (app-surface.md "`platform` and `catalog`"; FR-182, ADR 0021 D1).
// Thin: public, counted by the client address under `rate_limit_public_page`, one service call,
// the output parsed by its schema (R-API-1). Mounted under `catalog.subjects` by `app.router.ts`.
import { subjectsListOutput } from '@ijazah/contracts';
import { z } from 'zod';
import { PUBLIC_PAGE_RATE_LIMIT } from '../../platform/web/route.js';
import { createAppRouter, publicProcedure } from '../../surfaces/procedures.js';

export const subjectsRouter = createAppRouter({
  list: publicProcedure({
    input: z.void(),
    output: subjectsListOutput,
    rateLimit: { key: PUBLIC_PAGE_RATE_LIMIT, subjectOf: ({ ctx }) => ctx.clientAddress },
  }).query(({ ctx }) => ctx.services.subjects.listActive()),
});
