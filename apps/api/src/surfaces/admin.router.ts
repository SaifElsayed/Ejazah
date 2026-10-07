// T109: the ADMINISTRATOR surface, served to apps/admin (FR-048, R-API-11, R-SEC-8;
// contracts/kernel.md "Two surfaces", ARCHITECTURE §7.2).
//
// Built only from `adminProcedure`, on the administrator surface's own tRPC instance and context,
// and mounted by the HTTP application (T149) on its own path, apart from the user surface; its
// capabilities never appear in the user surface's type (T098). This is one of the three composition
// files that may import the admin module's public entry (T143): the module's router joins this
// record once the module exports one.
import { createAdminRouter } from './procedures.js';

export const adminRouter = createAdminRouter({});

/** The administrator surface's type, for apps/admin only. */
export type AdminRouter = typeof adminRouter;
