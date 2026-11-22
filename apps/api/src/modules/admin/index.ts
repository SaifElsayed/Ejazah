// PUBLIC ENTRY of the admin module (T017). Other modules import this file and nothing below it (R-API-3).
// Only the three composition files may import it (R-API-4, T143): main.ts, worker.ts, admin.router.ts.
import type { AuditWriter } from '../../platform/audit/audit-writer.js';
import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import {
  // T070 of specs/004-sessions: an administrator releases a held slot.
  createHeldSlotRelease,
  type HeldSlotRelease,
  lockActiveHoldsOf,
} from '../booking/index.js';
import {
  createCredentialReviewService,
  type CredentialReviewService,
  type OpenRequestsRefreeze,
  readCredentialQueue,
  revokeSubjects,
} from '../catalog/index.js';
// T072 of specs/004-sessions: a revocation's lift grants the approved credentials' subjects again.
import { credentialsOfTeachers, grantSubjects } from '../catalog/index.js';
// 006:T002 (SRS DEC-110; Q-3 (a)(a)): the programme's switch turned on retires the old ijazah packages.
import { lockProgrammeSwitch, retirePreProgrammeIjazahPackages } from '../catalog/index.js';
import {
  AccountConsequences,
  // T081 of specs/004-sessions: the administrator's deletion, identity's, handed in by `main.ts`.
  type AdministratorDeletion,
  // T004 of specs/005-certification: the certificate name's service, identity's, handed in by `main.ts`.
  type CertificateNames,
  readApplicationQueue,
  StandingService,
  standingStoreOver,
} from '../identity/index.js';
import { createPaymentsMonitorService } from '../payments/index.js';
import {
  type CaseClosingService,
  type CaseQueue,
  // T060.
  type ComplaintDecision,
  createComplaintDecision,
  createCaseClosing,
  createCaseQueue,
  createCompletion,
  // T061.
  createRestore,
  type Restore,
  createDisputeQueue,
  createDisputeResolution,
  createManualCase,
  createOutageServices,
  createRemedyOffer,
  createRevisions,
  createSessionCancel,
  createSessionReview,
  createSessionsMonitor,
  createSuspensionCase,
  createTelemetryReader,
  type DisputeQueue,
  type DisputeResolution,
  type EnrollmentSide,
  type ManualCaseService,
  type OutageServices,
  type Revisions,
  type SessionCancel,
  type SessionReview,
  type SessionsMonitor,
} from '../sessions/index.js';
// T073 of specs/004-sessions: the restore's port of a refund, payments' `refundedOf` handed in.
import type { EnrollmentPayments } from '../sessions/index.js';
// T040 of specs/004-sessions: the reads inside an open matter, over the held-files and chat ports.
import {
  createDisputeMatterReads,
  type DisputeChat,
  type DisputeHeldFiles,
  type DisputeMatterReads,
} from '../sessions/index.js';
// T071 of specs/004-sessions: a teacher's reinstatement resumes the paused enrollments (Q6 (a)).
import { createTeacherReinstatement } from '../sessions/index.js';
// T072 of specs/004-sessions: a ban's or a revocation's lift restores the enrollments it closed.
import { createBanLift } from '../sessions/index.js';
// T082 of specs/004-sessions: an administrator's direct end of an enrollment.
import { createEnrollmentEnd, type EnrollmentEnd } from '../sessions/index.js';
import {
  type ApplicationReviewService,
  createUserDirectory,
  createVerificationAdminServices,
  openRequestOf,
  type UserDirectory,
  type VerificationRequestService,
} from '../verification/index.js';
// T077 of specs/004-sessions: an administrator's control of a deleted teacher's kept data.
import { createKeptData, type KeptData } from '../verification/index.js';
// 005:T007 of specs/005-certification: the administrators' review of an ijazah request.
import type {
  AdminIjazahRequestsGetInput,
  AdminIjazahRequestsGetOutput,
} from '@ijazah/contracts/admin';
import {
  createIjazahDecisionService,
  type IjazahDecisionService,
  type RenderQueue,
} from '../certification/index.js';
// 005:T010 of specs/005-certification: an administrator's ijazahs, their revocation and the bar.
import { createIjazahsService, type IjazahsService } from '../certification/index.js';
// 005:T014 (B47; Q-G4 (a)): a corrected person's unsigned ijazahs re-rendered.
import { createPartyRerender } from '../certification/index.js';
// 005:T013 (B47): the gender-flag queue, moderation's flags composed here (R-409, Q-G1 (a)).
import type { AdminGenderFlags } from '../moderation/index.js';
// 005:T014 (B47): the correction's hold release reads payments' order standing (Q-G2 (c)).
import type { OrderStandings } from '../booking/index.js';
import { createGenderDecisions, type GenderDecisions } from './gender-decisions.service.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminInvites, type AdminInviteDependencies } from './admin-invite.js';
import { AdminSessionService, type AdminSessionDependencies } from './admin-session.service.js';
import { AdminSessionsRepository } from './admin-sessions.repository.js';
import { AdminUsersRepository, readAdministratorNames } from './admin-users.repository.js';
import { type AdminInviteQueue, AdminsService } from './admins.service.js';
import { AuditQueryService } from './audit-query.service.js';
import { AuditRepository, latestStandingReasonOf } from './audit.repository.js';
import { HomeService } from './home.service.js';
import { SettingsRepository } from './settings.repository.js';
import { SettingsService } from './settings.service.js';
// 005:T024 (B49; FR-624; R-410): the panel's `settings.list` and `settings.update`.
import { createSettingsAdministration, type SettingsAdministration } from './settings.service.js';

/** The four namespaces of the administrator surface, mounted by `admin.router.ts` (T067). */
export { adminsRouter } from './admins.router.js';
export { auditRouter } from './audit.router.js';
export { authRouter } from './auth.router.js';
export { homeRouter } from './home.router.js';
// 005:T013 (B47; Q-G1 (a)): the administrators' `genderFlags.*`, served by this module's router.
export { GENDER_DECISION_LIMIT, genderFlagsAdminRouter } from './gender-flags.router.js';
export type { GenderDecisions } from './gender-decisions.service.js';
// 005:T024 (B49; FR-624; R-410): the administrators' `settings.*`, served by this module's router.
export { SETTINGS_UPDATE_LIMIT, settingsAdminRouter } from './settings.router.js';
export type { SettingsAdministration } from './settings.service.js';

/** The administrator's session resolver, bound by `main.ts` for the HTTP application (T066). */
export { resolveAdminSession, type ResolvedAdminSession } from './admin-session.service.js';
export type { AdminInviteQueue, SignInNextStep };

type SignInNextStep = Awaited<ReturnType<AdminAuthService['signIn']>>['next'];

/**
 * The admin module's services, for the administrator surface's routers (T066, T067). `main.ts` binds
 * them to the surface's port (`AdminSurfaceServices` in `surfaces/context.ts`), which this module
 * may not name; a drift between the two fails that binding at type-check time.
 */
export interface AdminServices {
  readonly auth: Pick<
    AdminAuthService,
    'signIn' | 'verifyMfa' | 'recover' | 'beginSetup' | 'confirmSetup' | 'setPassword'
  >;
  readonly sessions: Pick<AdminSessionService, 'signOut'>;
  readonly admins: Pick<
    AdminsService,
    'me' | 'list' | 'add' | 'disable' | 'resetMfa' | 'regenerateRecoveryCodes'
  >;
  readonly audit: Pick<AuditQueryService, 'list' | 'get'>;
  readonly home: Pick<HomeService, 'summary'>;
  /** The catalog module's credential review, composed here for the surface (T069). */
  readonly credentials: Pick<
    CredentialReviewService,
    'list' | 'get' | 'approve' | 'reject' | 'requestDocument' | 'correct'
  >;
  /** The verification module's review and identity requests, and identity's standing (T068). */
  readonly applications: Pick<
    ApplicationReviewService,
    'list' | 'get' | 'recordCall' | 'approve' | 'reject' | 'requestInfo' | 'ban'
  >;
  readonly documents: Pick<
    VerificationRequestService,
    'link' | 'requireIdentity' | 'accept' | 'requestAnother'
  >;
  readonly teachers: Pick<
    StandingService,
    | 'suspend'
    | 'revokeApproval'
    | 'ban'
    | 'reinstate'
    // T072 of specs/004-sessions: a teacher's or an applicant's ban lifted, and a revocation,
    // keyed (`teachers.liftBan`, `teachers.liftRevocation`).
    | 'keyedLift'
  > & {
    /**
     * T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; Q-R3 (a)): `teachers.keptData.*`,
     * verification's kept-data service, keyed on the call's transaction (`runOn`).
     */
    // 005:T031 (B47, Q-D2 (a)): `signatureLink`, the kept signature.
    readonly keptData: Pick<
      KeptData,
      'documentLink' | 'signatureLink' | 'setEraseDate' | 'eraseNow'
    >;
  };
  /** A student's standing, identity's (T005 of specs/004-sessions, `002:T144`). */
  readonly students: Pick<
    StandingService,
    | 'suspendStudent'
    | 'banStudent'
    | 'reinstateStudent'
    // T072 of specs/004-sessions: a student's ban lifted, keyed (`students.liftBan`).
    | 'keyedLift'
  >;
  /** The payments module's read-only monitor, composed here for the surface (T052, FR-400). */
  readonly payments: ReturnType<typeof createPaymentsMonitorService>;
  /**
   * The sessions module's provider outage windows, composed here for the surface (T016 of
   * specs/004-sessions, FR-445): over the bound `EnrollmentSide` and sessions' completion, the
   * recorders' names read from this module's `admin_users` (`AdminNames`, Q6).
   */
  readonly outages: Pick<OutageServices, 'record' | 'list'>;
  /**
   * The sessions module's cancellation by an administrator, composed here for the surface (T023 of
   * specs/004-sessions, FR-460): over the bound `EnrollmentSide`'s lock and the process's logger.
   */
  readonly sessionCancel: SessionCancel;
  /**
   * The sessions module's enrollment and session monitor, composed here for the surface (T024 of
   * specs/004-sessions, FR-479): over the bound `EnrollmentSide`'s reads and the settings.
   */
  readonly monitor: SessionsMonitor;
  /**
   * The sessions module's compensation-case queue and its closings, composed here for the surface
   * (T035 of specs/004-sessions, FR-478, FR-422): over the bound `EnrollmentSide`, the settings and
   * the process's logger.
   */
  readonly cases: CaseQueue &
    CaseClosingService &
    ManualCaseService &
    // T060: a complaint of a teacher's absence decided.
    ComplaintDecision;
  /**
   * The sessions module's review queue, composed here for the surface (T033 of specs/004-sessions,
   * FR-477): over the bound `EnrollmentSide`'s lock, sessions' completion and its telemetry.
   */
  readonly review: SessionReview & { readonly revise: Revisions['correctOutcome'] };
  /**
   * The sessions module's disputes queue and ruling, composed here for the surface (T034 of
   * specs/004-sessions, FR-474 to FR-476): with this module's `StandingService` for a `party_*`
   * ruling and booking's `lockActiveHoldsOf` for the party's holds (kernel.md's `party_*` row).
   */
  readonly disputes: DisputeQueue &
    DisputeResolution & { readonly revise: Revisions['reviseRuling'] } &
    // T040: the reads inside an open matter (`disputes.heldFiles`, `disputes.heldFileLink`,
    // `disputes.chat`).
    DisputeMatterReads;
  /** T061 of specs/004-sessions: the sessions module's restore, keyed on the call's transaction. */
  readonly restore: Restore;
  /** T058 of specs/004-sessions: the verification module's user directory (FR-481, SRS FR-ADMIN-4). */
  readonly users: UserDirectory & {
    /** T081 of specs/004-sessions (FR-512): identity's deletion at the owner's request ⚠️. */
    readonly delete: AdministratorDeletion['deleteByAdministrator'];
    /** T004 of specs/005-certification (FR-602): identity's certificate-name change at the student's request. */
    readonly setCertificateName: CertificateNames['setByAdministrator'];
  };
  /** T070 of specs/004-sessions: booking's release of a held slot (`enrollments.releaseSlot`). */
  readonly enrollments: HeldSlotRelease;
  /**
   * T082 of specs/004-sessions: the sessions module's direct end of an enrollment
   * (`sessions.endEnrollment`), keyed on the call's transaction, booking's half through the bound
   * `EnrollmentSide`.
   */
  readonly enrollmentEnd: EnrollmentEnd;
  /**
   * 005:T007 of B46 (FR-604, FR-605, FR-628; Q10 (a), Q-C4 (a)): certification's review of an ijazah
   * request, `get` composed here with the teacher's standing reason from this module's audit log.
   */
  readonly ijazahRequests: Pick<IjazahDecisionService, 'list' | 'approve' | 'reject'> & {
    get(
      tx: Transaction,
      adminId: string,
      input: AdminIjazahRequestsGetInput,
    ): Promise<AdminIjazahRequestsGetOutput>;
  };
  /**
   * 005:T010 of B46 (FR-609, FR-610; R-412): certification's ijazahs, their revocation and the bar
   * (`ijazahs.list`, `.get`, `.revoke`, `.bar`, `.liftBar`), keyed on the call's transaction.
   */
  readonly ijazahs: Pick<
    IjazahsService,
    | 'list'
    | 'get'
    | 'revoke'
    | 'bar'
    | 'liftBar'
    // 005:T032 of B46 (FR-629): the sign-off and the re-render.
    | 'signOff'
    | 'rerender'
    // 005:T022 of B49 (Q-P2 (b)): the open bars, newest first.
    | 'barred'
  >;
  /**
   * 005:T013 of B47 (FR-614, FR-615; R-409; Q-G1 (a)): the gender-flag queue, moderation's flags
   * with `get`'s preview composed here from booking's and identity's entries.
   */
  readonly genderFlags: GenderDecisions;
  /**
   * 005:T024 of B49 (FR-624; SRS FR-ADMIN-9; R-410): the panel's settings, the registry's keys
   * with their stored values and a change through this module's one writer, keyed on the call's
   * transaction.
   */
  readonly settings: SettingsAdministration;
}

export interface AdminServiceDependencies extends AdminSessionDependencies {
  readonly encryptionKey: string;
  readonly inviteQueue: AdminInviteQueue;
  /** For the document viewer's signed links (T068). */
  readonly storage: Pick<StoragePort, 'temporaryLink' | 'remove'>;
  /**
   * The process's column cipher (`createColumnCipher`): the second factor's secret and the document
   * viewer's keys, read under the previous key too while a rotation runs (T134).
   */
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  /** The one registry of an account's end (FR-142), shared with the identity module's deletion (B16). */
  readonly consequences?: AccountConsequences;
  /**
   * Sessions' `EnrollmentSide`, bound once by `main.ts` to booking's `createEnrollmentSide()` (T015's
   * note; the owner's decision of 2026-11-08 on lane D's questions, Q5 (b)), for the outages.
   */
  readonly enrollmentSide: EnrollmentSide;
  /** The process's logger: the outage record's lines, «Enrollment completed» included (T016, T015). */
  readonly log: Pick<Logger, 'info' | 'warn'>;
  /**
   * The kernel's idempotency, keyed on the administrator kind's transaction (`runOn`; B39, the notes
   * under T059 and T064): `disputes.revise`, `sessions.review.revise` and `cases.openManual`.
   */
  readonly idempotency: IdempotencyService<Transaction>;
  /**
   * T040 of specs/004-sessions (spec FR-487, research R-327): sessions' `DisputeHeldFiles` port,
   * bound by `main.ts` to verification's `createDisputeHeldFiles()` (contracts/kernel.md, "The
   * composition root"), for `disputes.heldFiles` and `disputes.heldFileLink`.
   */
  readonly disputeHeldFiles: DisputeHeldFiles;
  /**
   * T040 of specs/004-sessions (FR-475, research R-314): sessions' `DisputeChat` port, bound by
   * `main.ts` to chat's `createDisputeChat()` (contracts/kernel.md, "The composition root"), for
   * `disputes.chat`.
   */
  readonly disputeChat: DisputeChat;
  /**
   * T073 of specs/004-sessions (FR-507; the note under T073, Q4 (a), Q6 (a), N3): sessions'
   * `EnrollmentPayments` port, filled by `main.ts` with payments' `refundedOf`, for the restore's
   * ninth cause `refunded` (docs/ARCHITECTURE.md §4, a dependency handed in against the arrows).
   */
  readonly enrollmentPayments: EnrollmentPayments;
  /**
   * T081 of specs/004-sessions (FR-512; SRS FR-ADMIN-22): identity's deletion, its
   * `deleteByAdministrator` keyed on the administrator kind's transaction, filled by `main.ts` with
   * the identity services' `deletion` (the one `DeletionService`), for `users.delete`.
   */
  readonly userDeletion: AdministratorDeletion;
  /**
   * T004 of specs/005-certification (FR-602; ADR 0019 D1; the note under T004, Q4 (a)): identity's
   * certificate-name service, its `setByAdministrator` keyed on the administrator kind's transaction,
   * filled by `main.ts` with the identity services' `certificateName`, for `users.setCertificateName`.
   */
  readonly certificateNames: CertificateNames;
  /**
   * T006 of specs/005-certification (P4 (a); the note under T006, Q-A4 (a)): catalog's
   * `OpenRequestsRefreeze`, filled by `main.ts` with certification's entry, for `credentials.correct`'s
   * re-freeze of the corrected credential's open ijazah requests on the correction's transaction.
   */
  readonly openRequestsRefreeze: OpenRequestsRefreeze;
  /**
   * 005:T007 of B46: `render-certificate`, enqueued by `main.ts`'s queue once an approval has
   * committed (`RENDER_CERTIFICATE`, `renderCertificatePayload`, job id `${ijazahId}-${generation}`).
   */
  readonly ijazahRenders: RenderQueue;
  /** 003:T109 (SRS DEC-87): the server's payment mode, which `home.summary` answers. */
  readonly paymentMode: 'test' | 'live';
  /**
   * 005:T013 of B47 (Q-G1 (a)): moderation's flags, the administrator's half of the one
   * `createGenderFlags` `main.ts` builds over the `Pairings` it binds.
   */
  readonly genderFlags: AdminGenderFlags;
  /**
   * 005:T014 of B47 (Q-G2 (c); the review's ruling of 2026-11-18, B46 Q-A4's precedent): payments'
   * `orderStandingsOf`, bound by `main.ts`, for the correction's release of the corrected person's
   * active holds (booking's `releaseHolds`, which locks the holds' orders after their enrollments).
   */
  readonly orders: OrderStandings;
}

export function createAdminServices(dependencies: AdminServiceDependencies): AdminServices {
  const sessions = new AdminSessionService(dependencies);
  const audit = new AuditQueryService(dependencies);
  // T061: the restore (R-322), keyed on the call's transaction, T028's offer widened for it; T072:
  // the one instance, whose core (`restoreClosed`) the lift calls too.
  const restore = createRestore({
    enrollments: dependencies.enrollmentSide,
    idempotency: dependencies.idempotency,
    offers: createRemedyOffer({
      enrollments: dependencies.enrollmentSide,
      settings: dependencies.settings,
      log: dependencies.log,
    }),
    settings: dependencies.settings,
    log: dependencies.log,
    // T073: a refund at the gateway refuses the restore (FR-507), payments' answer handed in.
    payments: dependencies.enrollmentPayments,
  });
  // T072 of specs/004-sessions (Q6 (a), Q9 (a); docs/ARCHITECTURE.md §4, a dependency handed in
  // against the arrows): the closed enrollments of a lift and `users.get`'s hold end.
  const banLift = createBanLift({
    enrollments: dependencies.enrollmentSide,
    restore,
    settings: dependencies.settings,
    log: dependencies.log,
  });
  // One registry for every action that ends an account (FR-142); Phase 2 and 3 subscribe to it.
  const standing = new StandingService({
    store: standingStoreOver(dependencies.database),
    consequences: dependencies.consequences ?? new AccountConsequences(),
    revokeSubjects,
    // A reinstatement lands on `verification_required` while verification's request is open (T113).
    hasOpenIdentityRequest: async (tx, userId) => (await openRequestOf(tx, userId)) !== null,
    // T071 of specs/004-sessions (Q6 (a); docs/ARCHITECTURE.md §4, a dependency handed in against
    // the arrows): the paused enrollments' students, then the offers and the cases' closing, on the
    // reinstatement's transaction; T028's offer writes its no-free-week warn line.
    reinstatement: createTeacherReinstatement({
      enrollments: dependencies.enrollmentSide,
      offers: createRemedyOffer({
        enrollments: dependencies.enrollmentSide,
        settings: dependencies.settings,
        log: dependencies.log,
      }),
      log: dependencies.log,
    }),
    // T072 of specs/004-sessions (Q6 (a)): the closed enrollments restored at a lift, and a
    // revocation's subjects granted again from the approved credentials (catalog's).
    lift: {
      counterpartiesOf: banLift.counterpartiesOf,
      restoreClosed: banLift.restoreClosed,
      grantApprovedSubjects: async (tx, teacherUserId) => {
        const approved = (await credentialsOfTeachers(tx, [teacherUserId]))
          .filter(({ status }) => status === 'approved')
          .map(({ subjectId }) => subjectId);
        await grantSubjects(tx, teacherUserId, [...new Set(approved)]);
      },
    },
    log: dependencies.log,
    // T072: a lift keyed on the call's transaction (`runOn`).
    idempotency: dependencies.idempotency,
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  });
  return {
    auth: new AdminAuthService({ ...dependencies, sessions }),
    sessions,
    admins: new AdminsService({ ...dependencies, sessions }),
    audit,
    // The home's two queues are the identity and catalog modules' tables, read through their
    // entries on the call's transaction (T065, R-API-6).
    home: new HomeService({
      ...dependencies,
      audit,
      queues: { applications: readApplicationQueue, credentials: readCredentialQueue },
    }),
    credentials: createCredentialReviewService(dependencies),
    ...createVerificationAdminServices({ ...dependencies, standing }),
    // T077 of specs/004-sessions (Q-R3 (a)): the standing's actions beside the kept data's three.
    teachers: {
      suspend: standing.suspend.bind(standing),
      revokeApproval: standing.revokeApproval.bind(standing),
      ban: standing.ban.bind(standing),
      reinstate: standing.reinstate.bind(standing),
      keyedLift: standing.keyedLift.bind(standing),
      keptData: createKeptData({
        storage: dependencies.storage,
        cipher: dependencies.cipher,
        settings: dependencies.settings,
        log: dependencies.log,
        idempotency: dependencies.idempotency,
      }),
    },
    students: standing,
    payments: createPaymentsMonitorService(dependencies),
    outages: createOutageServices({
      enrollments: dependencies.enrollmentSide,
      completion: createCompletion({
        enrollments: dependencies.enrollmentSide,
        settings: dependencies.settings,
      }),
      settings: dependencies.settings,
      log: dependencies.log,
      // The administrators' display names by id, this module's `admin_users` (R-API-6), handed to
      // sessions' outage list as its `AdminNames` (T016; the eighth dependency handed in against
      // the arrows, docs/ARCHITECTURE.md): one read for the page's recorders (PR #129's review, nit 4).
      adminNames: readAdministratorNames,
    }),
    sessionCancel: createSessionCancel({
      enrollments: dependencies.enrollmentSide,
      log: dependencies.log,
    }),
    monitor: createSessionsMonitor({
      enrollments: dependencies.enrollmentSide,
      settings: dependencies.settings,
      log: dependencies.log,
    }),
    cases: {
      ...createCaseQueue({
        enrollments: dependencies.enrollmentSide,
        settings: dependencies.settings,
        log: dependencies.log,
      }),
      ...createCaseClosing({
        log: dependencies.log,
        // T036: a suspended student's case closed; T028's offer writes its no-free-week warn line.
        suspension: createSuspensionCase({
          enrollments: dependencies.enrollmentSide,
          offers: createRemedyOffer({
            enrollments: dependencies.enrollmentSide,
            settings: dependencies.settings,
            log: dependencies.log,
          }),
          log: dependencies.log,
        }),
      }),
      // T064: the manual case (R-326), keyed on the call's transaction.
      ...createManualCase({
        enrollments: dependencies.enrollmentSide,
        idempotency: dependencies.idempotency,
        log: dependencies.log,
      }),
      // T060: a complaint decided (R-322), (b) over this module's standing and booking's holds lock.
      ...createComplaintDecision({
        enrollments: dependencies.enrollmentSide,
        standing,
        lockActiveHolds: lockActiveHoldsOf,
        log: dependencies.log,
      }),
    },
    ...adminSessionServices(dependencies, standing),
    // T061: the restore, built above (T072: one instance with the lift's).
    restore,
    // T058: the user directory over identity's readers and sessions' counts and marks.
    users: {
      ...createUserDirectory({
        database: dependencies.database,
        settings: dependencies.settings,
        enrollments: dependencies.enrollmentSide,
        log: dependencies.log,
        // T072 (Q9 (a)): `users.get`'s `enrollmentsSlotHeldUntil`, sessions' read.
        slotHeldUntilOf: banLift.slotHeldUntilOf,
      }),
      // T081: `users.delete`, identity's deletion on the call's transaction.
      delete: (tx, adminId, input) =>
        dependencies.userDeletion.deleteByAdministrator(tx, adminId, input),
      // T004 of specs/005-certification: `users.setCertificateName`, identity's, on the call's transaction.
      setCertificateName: (tx, adminId, input) =>
        dependencies.certificateNames.setByAdministrator(tx, adminId, input),
    },
    // T070: the release of a held slot, keyed through `runOn` on the call's transaction.
    enrollments: createHeldSlotRelease({
      idempotency: dependencies.idempotency,
      settings: dependencies.settings,
      log: dependencies.log,
    }),
    // T082: the direct end, keyed through `runOn` on the call's transaction.
    enrollmentEnd: createEnrollmentEnd({
      enrollments: dependencies.enrollmentSide,
      idempotency: dependencies.idempotency,
      log: dependencies.log,
    }),
    // 005:T007 of B46: the review, `get` with the standing's reason (Q10 (a), Q-C4 (a)).
    ijazahRequests: composeIjazahRequests({
      decisions: createIjazahDecisionService({
        storage: dependencies.storage,
        settings: dependencies.settings,
        idempotency: dependencies.idempotency,
        renders: dependencies.ijazahRenders,
        log: dependencies.log,
      }),
      standingReasonOf: latestStandingReasonOf,
      log: dependencies.log,
    }),
    // 005:T010 of B46: the ijazahs, keyed through `runOn` on the call's transaction.
    ijazahs: createIjazahsService({
      storage: dependencies.storage,
      settings: dependencies.settings,
      idempotency: dependencies.idempotency,
      log: dependencies.log,
      // 005:T032 of B46: a re-render's job, on the approval's queue (`main.ts`'s `ijazahRenders`).
      renders: dependencies.ijazahRenders,
      // 005:T022 of B49 (Q-P2 (b)): the barred list's administrators' names, this module's
      // `admin_users` (R-API-6), handed to certification's ijazahs service as sessions' outage list
      // gets them: the sixteenth dependency handed in against the arrows (docs/ARCHITECTURE.md:197
      // counts to the fifteenth; T026's §4 names it).
      adminNames: readAdministratorNames,
    }),
    // 005:T013 of B47: the gender-flag queue; 005:T014: the correction over the bound enrollment
    // side, the kernel's idempotency, payments' order standing and certification's re-render.
    genderFlags: createGenderDecisions({
      flags: dependencies.genderFlags,
      log: dependencies.log,
      enrollments: dependencies.enrollmentSide,
      idempotency: dependencies.idempotency,
      orders: dependencies.orders,
      rerenderOfParty: createPartyRerender({
        renders: dependencies.ijazahRenders,
        log: dependencies.log,
      }).rerenderOfParty,
      // 005:T015: the fraud ban's bans, the one standing service above.
      standing,
    }),
    // 005:T024 of B49: the panel's settings, keyed through `runOn` on the call's transaction,
    // written by this module's one writer on that transaction.
    settings: createSettingsAdministration({
      idempotency: dependencies.idempotency,
      log: dependencies.log,
      writerOn: (tx) => new SettingsRepository(tx),
      // 006:T002: catalog's entry, on the change's own transaction.
      retirePreProgrammeIjazahPackages,
      // 006:T004 (Q-D1 (a)): the programme switch's advisory key, before the switch is written.
      lockProgrammeSwitch,
    }),
  };
}

/** The newest standing entry of the audit log on a user: its action and reason (Q-C4 (a)). */
export interface StandingEntry {
  readonly action: string;
  readonly reason: string | null;
}

/** What `ijazahRequests` is composed over: certification's review and this module's audit read. */
export interface IjazahRequestsComposition {
  readonly decisions: Pick<IjazahDecisionService, 'list' | 'detail' | 'approve' | 'reject'>;
  readonly standingReasonOf: (tx: Transaction, userId: string) => Promise<StandingEntry | null>;
  readonly log: Pick<Logger, 'info' | 'warn'>;
}

/**
 * 005:T007 of B46 (Q-C4 (a)): the statuses each standing action can leave. The reason is shown only
 * when the newest entry's action agrees with the teacher's status now; a status set elsewhere (a
 * case ruling) would otherwise show an older entry's stale reason. A reinstatement lands on
 * `verification_required` while an identity request is open (identity's standing.service.ts:9),
 * and `user.require_identity` sets it (the review's ruling of 2026-11-17).
 */
const STANDING_STATUSES_OF: Readonly<Record<string, ReadonlySet<string>>> = {
  'teacher.suspend': new Set(['suspended']),
  'teacher.ban': new Set(['banned']),
  'application.ban': new Set(['banned']),
  'teacher.revoke': new Set(['revoked']),
  'teacher.reinstate': new Set(['active', 'verification_required']),
  'teacher.ban_lifted': new Set(['active']),
  'teacher.revocation_lifted': new Set(['active']),
  'user.require_identity': new Set(['verification_required']),
  // 005:T015 of B47 (the owner's word of 2026-11-18): the fraud ban bans the teacher.
  'gender.fraud_banned': new Set(['banned']),
};

/** `ijazahRequests` over certification's review, `get` with the guarded standing reason. */
export function composeIjazahRequests({
  decisions,
  standingReasonOf,
  log,
}: IjazahRequestsComposition): AdminServices['ijazahRequests'] {
  return {
    list: (tx, adminId, input) => decisions.list(tx, adminId, input),
    approve: (tx, adminId, input) => decisions.approve(tx, adminId, input),
    reject: (tx, adminId, input) => decisions.reject(tx, adminId, input),
    get: async (tx, adminId, input) => {
      const { teacherUserId, teacherStanding, ...detail } = await decisions.detail(
        tx,
        adminId,
        input,
      );
      const { status } = teacherStanding;
      const entry = await standingReasonOf(tx, teacherUserId);
      const agrees = entry !== null && (STANDING_STATUSES_OF[entry.action]?.has(status) ?? false);
      if (!agrees && (entry !== null || status !== 'active')) {
        log.info(
          {
            teacherUserId,
            requestId: input.requestId,
            status,
            action: entry?.action ?? null,
            reason: 'standing_reason_unmatched',
          },
          "A teacher's standing reason was not shown",
        );
      }
      const reason = agrees && entry !== null ? entry.reason : null;
      return { ...detail, teacherStanding: { status, ...(reason === null ? {} : { reason }) } };
    },
  };
}

/**
 * T033 and T034 of specs/004-sessions: the review queue and the disputes queue, over one completion
 * check and one telemetry reader; a `party_*` ruling's standing is the instance above (the owner's
 * decision of 2026-11-11 on lane A's question: each lane its own composition lines).
 */
function adminSessionServices(
  dependencies: AdminServiceDependencies,
  standing: StandingService,
): Pick<AdminServices, 'review' | 'disputes'> {
  const completion = createCompletion({
    enrollments: dependencies.enrollmentSide,
    settings: dependencies.settings,
  });
  const telemetry = createTelemetryReader({ settings: dependencies.settings });
  // T059: the revision and the correction, keyed through the shared idempotency.
  const revisions = createRevisions({
    enrollments: dependencies.enrollmentSide,
    idempotency: dependencies.idempotency,
    settings: dependencies.settings,
    log: dependencies.log,
  });
  return {
    review: {
      ...createSessionReview({
        enrollments: dependencies.enrollmentSide,
        completion,
        telemetry,
        settings: dependencies.settings,
        log: dependencies.log,
      }),
      revise: revisions.correctOutcome,
    },
    disputes: {
      ...createDisputeQueue({
        telemetry,
        revisions,
        settings: dependencies.settings,
        log: dependencies.log,
      }),
      revise: revisions.reviseRuling,
      ...createDisputeResolution({
        enrollments: dependencies.enrollmentSide,
        standing,
        lockActiveHolds: lockActiveHoldsOf,
        completion,
        log: dependencies.log,
      }),
      // T040: the reads inside an open matter, over the bound held-files and chat ports.
      ...createDisputeMatterReads({
        enrollments: dependencies.enrollmentSide,
        heldFiles: dependencies.disputeHeldFiles,
        chat: dependencies.disputeChat,
        log: dependencies.log,
      }),
    },
  };
}

/** The invites `deliver-admin-invite` sends, handed to the job by `worker.ts` (T066, R-110). */
export function createAdminInvites(dependencies: AdminInviteDependencies): AdminInvites {
  return new AdminInvites(dependencies);
}

/** The audit label's read-time name and the Arabic of the moved catalogue keys (T021, R-108). */
export { resolveTargetName, arabic as auditArabic, withLam } from './labels/target-name.js';
export { type AuditTargetType, targetLabel } from './labels/target-label.js';

/** The admin module's settings reader over the `settings` table, for the kernel to read through (T113). */
export function createSettingsReader(database: Database): SettingsReader {
  return new SettingsService(new SettingsRepository(database));
}

/**
 * The admin module's audit writer over `audit_logs`, for the administrator caller kind (T108). It
 * holds no client: each write runs on the action's own transaction.
 */
export function createAuditWriter(): AuditWriter {
  return new AuditRepository();
}

/** The admin module's `admin_sessions` store, for the `purge-expired-sessions` sweep (T025, R-API-6). */
export function createAdminSessionPurgeStore(
  database: Pick<Database, 'adminSession'>,
): AdminSessionsRepository {
  return new AdminSessionsRepository(database);
}

/** The admin module's `_encrypted` column, for the `reencrypt-columns` job (T155, R-API-6). */
export function createEncryptedColumns(
  database: Pick<Database, 'adminUser'>,
): readonly EncryptedColumn[] {
  return [new AdminUsersRepository(database).mfaSecrets()];
}
