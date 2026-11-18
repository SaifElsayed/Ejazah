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
// T003 of specs/005-certification: catalog's `teacher.signature`.
import {
  packagesRouter,
  slotsRouter,
  subjectsRouter,
  teacherSignatureRouter,
} from '../modules/catalog/index.js';
// T006 of specs/005-certification: certification's `teacher.ijazahRequests`; T009 its `certificates`.
import { certificatesRouter, ijazahRequestsRouter } from '../modules/certification/index.js';
// 005:T011 (B47): moderation's `reports`.
import { reportsRouter } from '../modules/moderation/index.js';
// 005:T013 (B47): moderation's `genderFlags`.
import { genderFlagsRouter } from '../modules/moderation/index.js';
// T037 of specs/004-sessions: the chat module's `chat`.
import { chatRouter } from '../modules/chat/index.js';
import {
  accountRouter,
  authRouter,
  onboardingRouter,
  payoutRouter,
  teacherProfileRouter,
} from '../modules/identity/index.js';
import { checkoutRouter } from '../modules/payments/index.js';
// 003:T105: payments' `teacher.dues`, the teacher's «مستحقاتي».
import { teacherDuesRouter } from '../modules/payments/index.js';
import { sessionsRouter } from '../modules/sessions/index.js';
import {
  applicationRouter,
  credentialsRouter,
  identityVerificationRouter,
} from '../modules/verification/index.js';
import { createAppRouter, mergeAppRouters } from './procedures.js';
import { liveRouter } from './live.router.js';
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
    // 003:T105: the teacher's own releases, held, due and paid, and his share of each refund.
    dues: teacherDuesRouter,
    // T006 of specs/005-certification: the ijazah request's preview, send and read.
    ijazahRequests: ijazahRequestsRouter,
    payout: payoutRouter,
    packages: packagesRouter,
    profile: teacherProfileRouter,
    // T003 of specs/005-certification: the teacher's signature, a signed link.
    signature: teacherSignatureRouter,
    slots: slotsRouter,
    students: teacherStudentsRouter,
    today: teacherTodayProcedure,
  }),
  discovery: discoveryRouter,
  booking: bookingRouter,
  checkout: checkoutRouter,
  enrollments: enrollmentsRouter,
  // T009 of specs/005-certification: the two parties' certificates.
  certificates: certificatesRouter,
  sessions: sessionsRouter,
  // T037 of specs/004-sessions: the chat module's `chat`.
  chat: chatRouter,
  // T063 of specs/004-sessions: the live channel, one subscription per signed-in device.
  live: liveRouter,
  // 005:T011 (B47): a user's report of another user from a session, a chat or a profile.
  reports: reportsRouter,
  // 005:T013 (B47): a user's flag of the declared gender of someone they are paired with or shown.
  genderFlags: genderFlagsRouter,
});

/** The user surface's type, the only one the mobile application may see. */
export type AppRouter = typeof appRouter;
