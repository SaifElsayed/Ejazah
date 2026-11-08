// T109: the USER surface, served to apps/mobile (FR-048, R-API-11; contracts/kernel.md "Two
// surfaces", ARCHITECTURE §7.2).
//
// Built only from the user surface's caller kinds (`publicProcedure`, `studentProcedure`,
// `teacherProcedure`), so no administrative capability can be part of it: `createAppRouter`
// accepts user-surface procedures only, so an administrator procedure does not compile here
// (T107), and T098 checks the same at runtime. Mounted on its own path by the HTTP application
// (T149), apart from the administrator surface. Each module's router joins this record as the
// module gains procedures: `platform.publicConfig` (the kernel's, beside the surfaces) and
// `catalog.subjects.list` (the catalog module's) since T038; the identity module's `auth`,
// `onboarding` and `account` since T048 and T049; the verification module's `teacher.application`
// and `teacher.credentials` since T056 and T057, and its `account.identityVerification`, merged into
// identity's `account`, since T068 (R-121); the identity module's `teacher.payout` since T077; the
// catalog module's `teacher.packages` since T018 and `teacher.slots` since T019; the booking module's
// `discovery` since T026 and `booking` since T032; the payments module's `checkout` since T036;
// the booking module's `enrollments`, `teacher.students` and `teacher.today` since T049; the sessions
// module's `sessions` since T011 of specs/004-sessions.
import {
  bookingRouter,
  discoveryRouter,
  enrollmentsRouter,
  teacherStudentsRouter,
  teacherTodayProcedure,
} from '../modules/booking/index.js';
import { packagesRouter, slotsRouter, subjectsRouter } from '../modules/catalog/index.js';
import {
  accountRouter,
  authRouter,
  onboardingRouter,
  payoutRouter,
  teacherProfileRouter,
} from '../modules/identity/index.js';
import { checkoutRouter } from '../modules/payments/index.js';
import { sessionsRouter } from '../modules/sessions/index.js';
import {
  applicationRouter,
  credentialsRouter,
  identityVerificationRouter,
} from '../modules/verification/index.js';
import { createAppRouter, mergeAppRouters } from './procedures.js';
import { platformRouter } from './public-config.router.js';

export const appRouter = createAppRouter({
  platform: platformRouter,
  catalog: createAppRouter({ subjects: subjectsRouter }),
  auth: authRouter,
  onboarding: onboardingRouter,
  account: mergeAppRouters(
    accountRouter,
    createAppRouter({ identityVerification: identityVerificationRouter }),
  ),
  teacher: createAppRouter({
    application: applicationRouter,
    credentials: credentialsRouter,
    payout: payoutRouter,
    packages: packagesRouter,
    profile: teacherProfileRouter,
    slots: slotsRouter,
    students: teacherStudentsRouter,
    today: teacherTodayProcedure,
  }),
  discovery: discoveryRouter,
  booking: bookingRouter,
  checkout: checkoutRouter,
  enrollments: enrollmentsRouter,
  sessions: sessionsRouter,
});

/** The user surface's type, the only one the mobile application may see. */
export type AppRouter = typeof appRouter;
