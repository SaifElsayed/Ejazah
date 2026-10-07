// T109: the USER surface, served to apps/mobile (FR-048, R-API-11; contracts/kernel.md "Two
// surfaces", ARCHITECTURE §7.2).
//
// Built only from the user surface's caller kinds (`publicProcedure`, `studentProcedure`,
// `teacherProcedure`), so no administrative capability can be part of it: the administrator kind
// belongs to the other tRPC instance, and T098 refuses one mounted here, in the type and at
// runtime. Mounted on its own path by the HTTP application (T149), apart from the administrator
// surface. Each module's router joins this record as the module gains procedures.
import { createAppRouter } from './procedures.js';

export const appRouter = createAppRouter({});

/** The user surface's type, the only one the mobile application may see. */
export type AppRouter = typeof appRouter;
