// T038: `platform.publicConfig` (app-surface.md "`platform` and `catalog`"; FR-145, ADR 0021 D4).
//
// One public, rate-limited query answering the support address and the current Terms version,
// the two values every app needs before anyone signs in. The address is `SUPPORT_EMAIL` from the
// configuration, never an admin setting (an admin account taken over must not point people at
// another mailbox); the version is the `terms_version` setting, read on every call (FR-034). Both
// reach the handler through the services the request context carries (`AppServices`), so this
// router is a static value the contract snapshot reads. It is a query, so an HTTP cache may hold
// its answer; the apps cache the last value and never block start-up on it.
//
// The file lives beside the surfaces, not under `platform/`, because a procedure is built from the
// surface's caller kinds and the kernel depends on nothing above it (ARCHITECTURE §4; PR #79
// review, finding 1).
import { publicConfigOutput, termsVersion } from '@ijazah/contracts';
import { z } from 'zod';
import { TERMS_VERSION_SETTING } from '../platform/settings/keys.js';
import { PUBLIC_PAGE_RATE_LIMIT } from '../platform/web/route.js';
import { createAppRouter, publicProcedure } from './procedures.js';

export const platformRouter = createAppRouter({
  publicConfig: publicProcedure({
    input: z.void(),
    output: publicConfigOutput,
    rateLimit: { key: PUBLIC_PAGE_RATE_LIMIT, subjectOf: ({ ctx }) => ctx.clientAddress },
  }).query(async ({ ctx }) => ({
    supportEmail: ctx.services.publicConfig.supportEmail,
    termsVersion: await ctx.services.settings.read(TERMS_VERSION_SETTING, termsVersion),
  })),
});
