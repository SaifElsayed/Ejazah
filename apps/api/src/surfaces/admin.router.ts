// T109: the ADMINISTRATOR surface, served to apps/admin (FR-048, R-API-11, R-SEC-8;
// contracts/kernel.md "Two surfaces", ARCHITECTURE §7.2).
//
// Built only from `adminProcedure`, on the administrator surface's own tRPC instance and context,
// and mounted by the HTTP application (T149) on its own path, apart from the user surface; its
// capabilities never appear in the user surface's type (T098). This is one of the three composition
// files that may import the admin module's public entry (T143): the admin module's four namespaces
// since T067, `auth`, `admins`, `audit` and `home`; the catalog module's `credentials` since T069;
// the verification module's `applications`, `documents` and `users` and the identity module's
// `teachers` since T068; the payments module's `payments`, the read-only monitor, since Phase 2's
// T052; the identity module's `students` since Phase 3's T005. Its anonymous procedures are exactly
// the six of `auth.*` that sign an administrator in (`admin.router.spec.ts`).
import { adminsRouter, auditRouter, authRouter, homeRouter } from '../modules/admin/index.js';
import { credentialsAdminRouter } from '../modules/catalog/index.js';
import { studentsRouter, teachersRouter } from '../modules/identity/index.js';
import { paymentsAdminRouter } from '../modules/payments/index.js';
import { applicationsRouter, documentsRouter, usersRouter } from '../modules/verification/index.js';
import { createAdminRouter } from './procedures.js';

export const adminRouter = createAdminRouter({
  auth: authRouter,
  admins: adminsRouter,
  audit: auditRouter,
  home: homeRouter,
  credentials: credentialsAdminRouter,
  applications: applicationsRouter,
  documents: documentsRouter,
  users: usersRouter,
  teachers: teachersRouter,
  students: studentsRouter,
  payments: paymentsAdminRouter,
});

/** The administrator surface's type, for apps/admin only. */
export type AdminRouter = typeof adminRouter;
