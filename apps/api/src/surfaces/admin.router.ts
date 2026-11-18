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
// T052; the identity module's `students` since Phase 3's T005; the sessions module's `sessions`
// since Phase 3's T016 (its outage windows; the monitor, the review queue, the cancellation and
// the restore join it in their tasks), and its `disputes` (T034, T059) and `cases` (T035, T064)
// since B39. Its anonymous procedures are exactly
// the six of `auth.*` that sign an administrator in (`admin.router.spec.ts`).
import { adminsRouter, auditRouter, authRouter, homeRouter } from '../modules/admin/index.js';
// 005:T013 to T015 (B47; Q-G1 (a)): the admin module's `genderFlags`, over moderation's flags.
import { genderFlagsAdminRouter } from '../modules/admin/index.js';
// T070 of specs/004-sessions: booking's `enrollments` namespace.
import { enrollmentsAdminRouter } from '../modules/booking/index.js';
// T007 of specs/005-certification: certification's `ijazahRequests`; T010 and T032 its `ijazahs`.
import { ijazahRequestsAdminRouter, ijazahsAdminRouter } from '../modules/certification/index.js';
// 005:T011 (B47): moderation's administrators' `reports`.
import { reportsAdminRouter } from '../modules/moderation/index.js';
import { credentialsAdminRouter } from '../modules/catalog/index.js';
import { studentsRouter, teachersRouter } from '../modules/identity/index.js';
import { paymentsAdminRouter } from '../modules/payments/index.js';
// 003:T105: payments' «تحويلات المعلمين», the `payouts` namespace.
import { payoutsAdminRouter } from '../modules/payments/index.js';
import {
  casesAdminRouter,
  disputesAdminRouter,
  sessionsAdminRouter,
} from '../modules/sessions/index.js';
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
  sessions: sessionsAdminRouter,
  disputes: disputesAdminRouter,
  cases: casesAdminRouter,
  // T070 of specs/004-sessions: booking's `enrollments` namespace.
  enrollments: enrollmentsAdminRouter,
  // T007 of specs/005-certification: the administrators' review of an ijazah request.
  ijazahRequests: ijazahRequestsAdminRouter,
  // T010 and T032 of specs/005-certification: ijazahs, their revocation, the bar and the sign-off.
  ijazahs: ijazahsAdminRouter,
  // 005:T011 (B47): the administrators' queue of reports, their detail and resolution.
  reports: reportsAdminRouter,
  // 005:T013 to T015 (B47): the gender flags' queue, the correction and the fraud ban.
  genderFlags: genderFlagsAdminRouter,
  // 003:T105: the releases of the teachers' shares, their detail and the mark «تم الصرف».
  payouts: payoutsAdminRouter,
});

/** The administrator surface's type, for apps/admin only. */
export type AdminRouter = typeof adminRouter;
