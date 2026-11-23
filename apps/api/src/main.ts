// Request process entrypoint (T008, T149). HTTP only. Refuses traffic until configuration validates
// (FR-039).
//
// `loadConfigOrExit` is the first call (note under T015): on an invalid configuration the process
// exits 1 naming the offending keys before anything is built, logged or listening (T093). Everything
// else is loaded only after it returns, so a refusal loads nothing but the configuration schema and
// stays quick. Then reporting is started (T111), the logger created (T100), the database client
// opened (T102), the admin module's settings reader bound (T113), the rate limiter built over it
// (T103), the admin module's audit writer bound (T108), each port's provider selected (T121), and the application with both surfaces mounted (T149) and the health routes registered
// (T110) made to listen. A deploy's SIGTERM, or an operator's SIGINT, stops it once and cleanly
// (T173): the application stops listening and closes, then the database client is closed, and the
// process exits with that sequence's outcome.
import { loadConfigOrExit } from './platform/config/config.module.js';

const config = loadConfigOrExit();

const [
  { initReporting },
  { createLogger },
  { closeDatabase, openDatabase },
  { apiStopSequence, onShutdown },
  { InProcessLiveBus },
  { LiveRegistry },
  { ReadinessRepository },
  { requireSettingsReader },
  { createRateLimiter },
  { transactionsOver },
  { requireAuditWriter },
  { createAdminServices, createAuditWriter, createSettingsReader, resolveAdminSession },
  catalog,
  booking,
  identity,
  verification,
  { createColumnCipher },
  { IdempotencyService },
  { IdempotencyRepository },
  { createRedisSingleUseMarks },
  { selectPorts },
  { TERMS_PATH, termsRoute },
  { createApplication },
  { addOrRetry, connectionFor, openQueue },
  { DELIVER_ADMIN_INVITE },
  { filesRoutes },
  payments,
  { standInCheckoutRoutes },
  { CONFIRM_ENROLLMENT },
  sessionsModule,
  chat,
  // T003 of specs/005-certification, the owner's Q16 (b): the image line's numbers (T073).
  { PHOTOS_PROCESSED_AT_ONCE, PHOTO_TURN_WAIT_MS },
  // T006 of specs/005-certification: the ijazah request's service and its router.
  certification,
  // T007 of specs/005-certification: approve's after-commit enqueue of the certificate's render.
  { RENDER_CERTIFICATE, renderCertificatePayload },
  // 005:T011 (B47): the report service and the `Pairings` port it reads parties through.
  moderation,
  // 005:T016 (B48): the push producers' one writer and its delivery job's name.
  notifications,
  { DELIVER_NOTIFICATION },
] = await Promise.all([
  import('./platform/errors/reporting.js'),
  import('./platform/logging/logger.js'),
  import('./platform/db/prisma.repository.js'),
  import('./platform/lifecycle/shutdown.js'),
  import('./platform/live/live-bus.js'),
  import('./platform/live/live-registry.js'),
  import('./platform/db/readiness.repository.js'),
  import('./platform/settings/settings-reader.js'),
  import('./platform/guards/rate-limit.guard.js'),
  import('./platform/db/transaction.repository.js'),
  import('./platform/audit/audit-writer.js'),
  import('./modules/admin/index.js'),
  import('./modules/catalog/index.js'),
  import('./modules/booking/index.js'),
  import('./modules/identity/index.js'),
  import('./modules/verification/index.js'),
  import('./platform/crypto/encryption.js'),
  import('./platform/idempotency/idempotency.service.js'),
  import('./platform/idempotency/idempotency.repository.js'),
  import('./platform/redis/single-use-marks.js'),
  import('./platform/ports/ports.module.js'),
  import('./platform/web/terms/terms.controller.js'),
  import('./app.module.js'),
  import('./jobs/queue.js'),
  import('./jobs/deliver-admin-invite.js'),
  import('./platform/ports/storage/files.route.js'),
  import('./modules/payments/index.js'),
  import('./platform/web/stand-in-checkout.js'),
  import('./jobs/confirm-enrollment.js'),
  import('./modules/sessions/index.js'),
  import('./modules/chat/index.js'),
  import('./platform/guards/upload.middleware.js'),
  import('./modules/certification/index.js'),
  import('./jobs/render-certificate.js'),
  import('./modules/moderation/index.js'),
  import('./modules/notifications/index.js'),
  import('./jobs/deliver-notification.js'),
]);

initReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const log = createLogger({ level: config.LOG_LEVEL });
const database = openDatabase(config.DATABASE_URL, {
  poolMax: config.DATABASE_POOL_MAX,
  statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
  idleInTransactionTimeoutMs: config.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

// Every operational number is read through this reader (FR-034); the process refuses to start
// without one. It is handed to each kernel part that reads settings as that part arrives (T103's
// rate limits, the idempotent procedures of the surfaces). No key is read here: the store is empty
// until the seed (T074), and an empty store must not stop the process booting.
const settings = requireSettingsReader(createSettingsReader(database));

// The live channel (T063 of specs/004-sessions, R-324): one in-process bus and the registry of
// this process's open streams. Every request's context carries a publisher over the bus,
// `live.events` opens its streams in the registry, and shutdown ends them first. The worker
// publishes nothing live.
const liveBus = new InProcessLiveBus();
const liveRegistry = new LiveRegistry({ bus: liveBus, settings, log });

// The process's one rate limiter (T103, FR-043): it counts in Redis and reads each limit from the
// settings above on every call. Every user-surface request carries it in its context (T170), so a
// procedure's declared limit is applied by its caller kind; it connects to Redis on its first
// count, and hashes each subject under a key derived from ENCRYPTION_KEY.
const rateLimiter = createRateLimiter({
  redisUrl: config.REDIS_URL,
  settings,
  log,
  encryptionKey: config.ENCRYPTION_KEY,
});

// Every administrative call runs in one transaction and writes its audit record there, through the
// admin module's writer (T108, FR-049); the process refuses to start without one, so no
// administrative route exists around it.
const administration = {
  transactions: transactionsOver(database),
  auditWriter: requireAuditWriter(createAuditWriter()),
};

// Each port's provider is chosen here, once, from the configuration (T121, FR-056), and handed to
// each module as its first consumer arrives. The request process never holds the push port
// (R-API-15).
// 003:T101 (track 2, B-M1): the payment gateway writes its warn line to the process's logger.
const ports = selectPorts(config, log);

// What the identity module's services are built over (T048): the database, the settings, the key
// its tokens are signed under, and the single-use marks of nonces and onboarding tokens in Redis,
// which connect on their first mark and report a lost connection as the limiter does.
const identityBase = {
  database,
  settings,
  encryptionKey: config.ENCRYPTION_KEY,
};

// The session resolvers (T017): the identity module's `resolveUserSession` (T047) reads a user's
// session and standing on every request, and the admin module's `resolveAdminSession` (T066) an
// administrator's session, whether its second factor passed, and the administrator's standing.
const sessions = {
  user: identity.resolveUserSession(identityBase),
  admin: resolveAdminSession({ database, settings }),
};

// The column cipher (R-DB-8): the documents route encrypts a document's storage key with it, and
// the credentials' links decrypt it (T024, T057); onboarding and deletion read Apple's grant, and
// the administrator's sign-in and admins page the second factor's secret, with it, so each reads a
// value under the previous key too while a rotation runs (T134).
const cipher = createColumnCipher(config);

// What the user surface's procedures read (T038): the settings reader, the support address from
// the configuration (FR-145, never an admin setting), the catalog module's subjects read, the
// identity module's services behind `auth`, `onboarding` and `account` (T048, T049), and the
// verification module's behind `teacher.application` and `teacher.credentials` (T056, T057), the
// application's submission and the payout registration keyed through the kernel's idempotency
// (FR-106), the payout registration over the payment port (T077), and the catalog module's behind
// `teacher.packages` and `teacher.slots`, whose `CatalogUse` port is bound to booking's entry
// (T020, R-207): catalog asks whether a slot or a package is in use without importing booking;
// and booking's `discovery` over catalog's discovery service (T026, R-205) and its `booking`
// namespace, the booking sheet's slots (T032).
// The one registry of an account's end (FR-142): the admin module's standing actions and the
// identity module's deletion call it, and the modules that keep what an account had subscribe to it
// (B16 check, decision 2). The verification module subscribes the erasure of a deleted person's
// documents, and its file erasure removes their files after the deletion's commit (decision 1).
// Booking subscribes the release of the account's holds and the cancellation of their enrollments
// awaiting payment (T041, R-219), over payments' order standing (R-208).
const consequences = new identity.AccountConsequences();
consequences.subscribe(verification.documentErasureConsequence());
consequences.subscribe(booking.terminationSubscriber({ orders: payments.orderStandingsOf, log }));
// T174 of specs/002-identity (R1a; SRS DEC-97, FR-AUTH-14; the note under T174, (5)): catalog's
// consequence, so no module reaches another's tables. The deletion of a teacher never approved blanks
// their credentials' holder name, riwaya, tariq and review reason, deletes their chains and erases
// the credentials' history; a teacher once approved keeps all of it.
consequences.subscribe(catalog.catalogDeletionConsequence());
const idempotency = new IdempotencyService({
  store: new IdempotencyRepository(database),
  settings,
});
// The queue (T112), opened on the first add, so a process that never adds a job never connects to it
// for that: `admins.add` queues `deliver-admin-invite` (T067), the webhook's paid events
// `confirm-enrollment` (T038), and the certificate's renders (005:T007, T032).
let jobQueue: ReturnType<typeof openQueue> | undefined;
const queue = (): ReturnType<typeof openQueue> =>
  (jobQueue ??= openQueue(connectionFor(config.REDIS_URL)));
// 005:T007, T032 (Q6 (a)): one ijazah's render, enqueued after its producer's commit under the job id
// `<ijazahId>-<generation>` (BullMQ refuses `:` in a custom id), through `addOrRetry`, so a failed job
// held under that id is retried rather than silently kept. Approve's, the re-render's and the two
// ports' re-freezes before the sign-off all enqueue here.
const certificateRenders = {
  enqueue: async (ijazahId: string, generation: number): Promise<void> => {
    await addOrRetry(
      queue(),
      {
        name: RENDER_CERTIFICATE,
        data: renderCertificatePayload(ijazahId, generation),
        jobId: `${ijazahId}-${generation}`,
      },
      log,
    );
  },
};
// 005:T016 (B48; the note under T016, Q-N1 (a), Q-N3 (a)): the one writer of the push producers,
// bound to sessions' `CancellationNotices` and booking's `PaymentOutcomeNotices` (as payments'
// `notices`), so no module imports notifications. Each push is enqueued after its producer's commit
// under the notification's id, through `addOrRetry`; a lost enqueue is `send-reminder`'s re-send.
const notificationWriter = notifications.createNotificationWriter({
  database,
  queue: {
    enqueue: async (notificationId: string): Promise<void> => {
      await addOrRetry(
        queue(),
        { name: DELIVER_NOTIFICATION, data: { notificationId }, jobId: notificationId },
        log,
      );
    },
  },
  log,
});
// T006 of specs/005-certification (the note under T006, Q4 (a), Q14 (a)): the ijazah request's one
// service. Certification's entry is bound to the three ports the other modules declare, so none of
// them imports certification (`docs/ARCHITECTURE.md:195`): identity's `AwaitingNameRelease` and
// `AccountConsequences` (a student's deletion closes their open requests and erases each copy after
// the commit), booking's `EnrollmentIjazahRequests` and catalog's `OpenRequestsRefreeze` (below).
const ijazahRequests = certification.createIjazahRequestService({
  database,
  storage: ports.storage,
  idempotency,
  log,
  // 005:T032: the ports' re-freeze of an ijazah before its sign-off re-renders it after the commit.
  renders: certificateRenders,
});
consequences.subscribe(ijazahRequests.deletionConsequence());
// Sessions' `EnrollmentSide` port bound to booking's side (T008, bound by T015 of specs/004-sessions,
// the note under T015): one instance, handed to the sessions services and the administrator's
// outages (T016), as `booking.createCatalogUse({ settings })` is bound below.
const enrollmentSide = booking.createEnrollmentSide({ settings });
// T003 of specs/005-certification: the teacher's signature, one service for `POST /uploads/signature`
// and `teacher.signature.get` (R-411).
const teacherSignatures = catalog.createTeacherSignatureService({
  database,
  storage: ports.storage,
  settings,
  log,
});
// T003 of specs/005-certification, the owner's Q16 (b): one image line for the process, handed to the
// photos route and the signature route, so one image is decoded at a time across both (T073).
const imageTurns = new identity.PhotoTurns({
  atOnce: PHOTOS_PROCESSED_AT_ONCE,
  waitMs: PHOTO_TURN_WAIT_MS,
});
// 005:T011 (B47; FR-611, FR-612; research R-408; the note under T011): one report service for both
// surfaces, over the `Pairings` port bound here to sessions' and booking's entries, so moderation
// imports neither.
const userReports = moderation.createUserReports({
  idempotency,
  pairings: {
    partyOfSession: sessionsModule.partyOfSession,
    partyOfEnrollment: booking.partyOfEnrollment,
    paired: booking.paired,
  },
  settings,
});
// 005:T013 (B47; FR-613 to FR-615; research R-409; the note under T013, Q-G1 (a)): one gender-flag
// service for both surfaces, over the `Pairings` port's `paired`, bound here to booking's entry.
const genderFlags = moderation.createGenderFlags({
  idempotency,
  pairings: { paired: booking.paired },
  settings,
});
// 003:T105 (SRS DEC-81, DEC-89; the notes under T105): the releases of the teachers' shares, one
// service for both surfaces: the teacher's «مستحقاتي» and the administrators' «تحويلات المعلمين».
const payouts = payments.createPayoutServices({ database, settings, idempotency, cipher, log });
const services = {
  settings,
  // 003:T109 (track 2, B-M1): the payment mode every app's «نسخة تجريبية» banner reads.
  publicConfig: { supportEmail: config.SUPPORT_EMAIL, paymentMode: config.PAYMENT_MODE },
  subjects: catalog.createSubjectsService(database),
  identity: {
    ...identity.createIdentityServices({
      ...identityBase,
      cipher,
      // T063: a deleted person's `account`, sent after the deletion's commit, ends their streams.
      live: liveBus,
      // 002:T173 (SRS §3.14, DEC-100): the failed one-time codes' cap, on the process's limiter.
      failedCodes: rateLimiter,
      marks: createRedisSingleUseMarks({
        redisUrl: config.REDIS_URL,
        onError: (error) => log.warn({ err: error }, 'Single-use marks unreachable'),
      }),
      signIn: ports.signIn,
      email: ports.email,
      storage: ports.storage,
      log,
      payment: ports.payment,
      idempotency,
      consequences,
      fileErasures: [
        verification.createDocumentErasure({ database, cipher, storage: ports.storage }),
        // 005:T031 (B47, Q-D3 (a), Q-D4 (a)): a never-approved teacher's signature, erased after the
        // deletion's commit; an approved teacher's waits for the kept data's erasure (worker.ts).
        verification.createKeptSignatureErasure({ database, storage: ports.storage }),
      ],
      // T004 of specs/004-sessions (FR-487, R-327): identity's `FileHold` port, bound to booking's
      // entry, so identity imports no booking.
      fileHold: {
        filesHeld: async (userId) =>
          (await booking.heldFileOwnersAmong(database, [userId])).has(userId),
      },
      // T080 of specs/004-sessions (FR-511): the deletion's count of ongoing enrollments, booking's,
      // asked on the deletion's own transaction after the account's lock, so identity imports no booking.
      ongoingEnrollments: booking.createOngoingEnrollments({ settings }),
      // 005:T031 (B47; FR-630; R-414; the note under T031, Q-D1 (a)): a teacher's deletion waits for
      // their open ijazah requests (certification's count) and, by an administrator, their open
      // compensation cases (booking's enrollment ids composed with moderation's count), on the
      // deletion's transaction after the account's lock; identity imports neither module.
      openIjazahRequests: { count: certification.openRequestCountOfTeacher },
      openCases: {
        count: async (tx, teacherUserId) =>
          moderation.openCompensationCasesAmong(
            tx,
            await booking.enrollmentIdsOfTeacher(tx, teacherUserId),
          ),
      },
    }),
    // T004 of specs/005-certification (FR-602): the certificate name. Its `AwaitingNameRelease` is
    // bound to certification's request service (T006), so identity imports no module.
    certificateName: identity.createCertificateNameService({
      idempotency,
      log,
      awaitingNameRelease: {
        release: (tx, studentUserId) => ijazahRequests.release(tx, studentUserId),
      },
    }),
  },
  verification: verification.createVerificationServices({
    database,
    storage: ports.storage,
    cipher,
    settings,
    idempotency,
  }),
  catalog: {
    ...catalog.createCatalogServices({
      database,
      idempotency,
      // 003:T113 (Q-T113-k): the average's `price_average_min_teachers`.
      settings,
      // A slot's release (T026, R-205) reads the clock and `slot_release_buffer_weeks`.
      use: booking.createCatalogUse({ settings }),
    }),
    // T003 of specs/005-certification: `teacher.signature.get`.
    signature: teacherSignatures,
  },
  // `teacher.profile` (T017): the identity module's, the photo answered as the storage port's link.
  teacherProfile: identity.createTeacherProfileService({
    database,
    settings,
    storage: ports.storage,
  }),
  // `discovery` (T026, T027): catalog's discovery service (T025) composed with booking's nearest
  // slots; the profile's photo is the storage port's signed link (T027).
  discovery: booking.createDiscoveryServices({
    // T025's catalog discovery through catalog's entry, each call in a transaction of its own (B27
    // integration): the seam takes none, and catalog's reads run on the one they are given.
    catalog: (() => {
      const discovery = catalog.createDiscoveryCatalog(settings, ports.storage);
      const reads = transactionsOver(database);
      return {
        browse: (requester, input) => reads.run((tx) => discovery.browse(tx, requester, input)),
        filters: (requester, input) => reads.run((tx) => discovery.filters(tx, requester, input)),
        teacher: (requester, input) => reads.run((tx) => discovery.teacher(tx, requester, input)),
      };
    })(),
    database,
    settings,
  }),
  // `booking` (T032): the booking sheet's slots, over catalog's, identity's and sessions' entries.
  // T006 of specs/005-certification (Q4 (a)): the enrollment details' `ijazahRequest`, through
  // booking's `EnrollmentIjazahRequests` port bound to certification's request service.
  booking: booking.createBookingServices({
    database,
    settings,
    ijazahRequests: { of: (tx, enrollmentIds) => ijazahRequests.of(tx, enrollmentIds) },
    // 006:T007 (FR-705, K-5; Q-A1 (a)): `programme.offer`, keyed, its amounts payments'.
    idempotency,
    log,
    programmeAmounts: payments.programmeOfferAmountsOf,
  }),
  // `checkout` (T036): the payments module's, the gateway's orders created outside any transaction
  // over the payment port and recorded through booking's holds and enrollments (R-208), keyed in two
  // steps through the kernel's idempotency, the address encrypted with the column cipher (R-DB-8).
  checkout: payments.createCheckoutServices({
    database,
    settings,
    idempotency,
    payment: ports.payment,
    cipher,
    gateway: config.PAYMENT_GATEWAY,
    // 005:T016: the checkout's payment outcomes record their push.
    notices: notificationWriter,
  }),
  // `sessions.get` and `sessions.join` (T011 of specs/004-sessions): the session read under both
  // accounts' locks, the room and the token through the video port after the commit. The kernel's
  // idempotency keys `sessions.cancellation.request` (T021) and runs `sessions.dispute.raise` (T026).
  sessions: sessionsModule.createSessionsServices({
    transactions: transactionsOver(database),
    settings,
    video: ports.video,
    enrollmentSide,
    store: sessionsModule.sessionsStore,
    idempotency,
    // 005:T016: the cancellation request and its answer record their push.
    notifications: notificationWriter,
  }),
  // `chat.list`, `chat.send` and `chat.attachmentLink` (T037, T038 of specs/004-sessions): the
  // enrollment's parties and status through booking's side (R-301), `chat.send` keyed by the
  // kernel's idempotency, an attachment's link through the storage port (R-SEC-3).
  chat: chat.createChatServices({
    transactions: transactionsOver(database),
    idempotency,
    settings,
    enrollments: enrollmentSide,
    storage: ports.storage,
  }),
  // `teacher.ijazahRequests.*` (T006 of specs/005-certification): the request's service above.
  // `certificates.list` and `.link` (T009 of specs/005-certification): the two parties' signed-off PDF
  // through a signed link under `document_link_ttl_seconds`, never a storage key (R-SEC-3, R-HONEST-6).
  certification: {
    ijazahRequests,
    certificates: certification.createCertificatesService({
      database,
      storage: ports.storage,
      settings,
      log,
    }),
  },
  // `reports.create` (005:T011, B47) and `genderFlags.raise` (005:T013, B47): the services above.
  moderation: { reports: userReports, genderFlags },
  // 003:T105: `teacher.dues.get`, the service above.
  teacherDues: payouts.teacher,
};

// The two upload routes (T024, public-pages.md "The uploads route"), each over the surfaces' upload
// helper with the user session resolver, T020's guard and the storage port; the documents route
// encrypts its key with the column cipher (R-DB-8) and refuses an uploader holding
// `document_unreferenced_max_per_user` documents nothing points at, read through the identity and
// catalog modules' pointers (T093, R-API-6). Beside them, over local storage alone, the route that
// serves its signed links (T095).
const documentReferences = [
  identity.createDocumentReferences(database),
  catalog.createDocumentReferences(database),
];
// T147: the one proxy's header, read only from the proxy's own address; the configuration refuses
// the header without the address.
const trustedProxy =
  config.TRUSTED_PROXY === undefined || config.TRUSTED_PROXY_ADDRESS === undefined
    ? {}
    : { trustedProxy: { header: config.TRUSTED_PROXY, address: config.TRUSTED_PROXY_ADDRESS } };
const uploads = {
  sessions: sessions.user,
  guard: { settings, rateLimiter },
  log,
  // T063: an upload's after-commit point flushes over the bus.
  live: liveBus,
  ...trustedProxy,
};
const routes = {
  [verification.DOCUMENTS_UPLOAD_PATH]: verification.createDocumentsUploadRoute({
    ...uploads,
    storage: ports.storage,
    cipher,
    database,
    settings,
    references: documentReferences,
  }),
  [identity.PHOTOS_UPLOAD_PATH]: identity.createPhotoUploadRoute({
    ...uploads,
    storage: ports.storage,
    settings,
    database,
    // T003 of specs/005-certification: the process's one image line, shared with the signature route.
    turns: imageTurns,
  }),
  // The upload route's third use (T038 of specs/004-sessions): `POST /uploads/chat`, a PDF or UTF-8
  // text document sent in an enrollment's chat, never an image (R-SEC-4, R-SEC-5).
  [chat.CHAT_UPLOAD_PATH]: chat.createChatUploadRoute({
    ...uploads,
    storage: ports.storage,
    transactions: transactionsOver(database),
    enrollments: enrollmentSide,
  }),
  // T003 of specs/005-certification: `POST /uploads/signature`, an approved teacher's PNG or JPEG
  // signature decided by content (R-SEC-4), one current row, the old file erased after the commit.
  [catalog.SIGNATURE_UPLOAD_PATH]: catalog.createSignatureUploadRoute({
    ...uploads,
    signatures: teacherSignatures,
    turns: imageTurns,
  }),
  ...filesRoutes(ports.storage),
  // The gateway's signed webhook (T077): its raw body read under the request limit, verified by the
  // payment port, and a recipient event recorded and handed to identity's entries (R-121); an order
  // event recorded and its order moved, a paid one enqueueing `confirm-enrollment` by the payment's
  // id, under that id as the job's (T038, R-214).
  [payments.PAYMENT_WEBHOOK_PATH]: payments.createPaymentWebhookRoute({
    database,
    payment: ports.payment,
    log,
    maxBodyBytes: config.MAX_REQUEST_BODY_BYTES,
    confirmations: {
      enqueue: async (paymentId) => {
        await addOrRetry(
          queue(),
          { name: CONFIRM_ENROLLMENT, data: { paymentId }, jobId: paymentId },
          log,
        );
      },
    },
    // 005:T016: an order's failure records its push on the event's transaction.
    notices: notificationWriter,
  }),
  // The video provider's signed webhook (T012 of specs/004-sessions, R-SESS-7): its raw body read
  // under the request limit, verified through the video port before anything runs, and an
  // attendance event recorded once under its provider id; T065: once it commits, the other
  // participant (both, for the room's end) is sent `session` over the bus.
  [sessionsModule.VIDEO_WEBHOOK_PATH]: sessionsModule.createVideoWebhookRoute({
    transactions: transactionsOver(database),
    video: ports.video,
    log,
    maxBodyBytes: config.MAX_REQUEST_BODY_BYTES,
    live: liveBus,
  }),
  // The stand-in's hosted page (T012, R-213): a route only while the payment port is the stand-in
  // (`PAYMENT_GATEWAY=fake`); it posts its signed events to the webhook above over HTTP.
  ...standInCheckoutRoutes({
    payment: ports.payment,
    rateLimiter,
    log,
    ...trustedProxy,
  }),
};

// The admin module's services behind the administrator surface (T067), bound to the surface's port.
// `admins.add` queues `deliver-admin-invite` with the id alone (R-110), on the queue above.
const adminModuleServices = createAdminServices({
  database,
  settings,
  encryptionKey: config.ENCRYPTION_KEY,
  storage: ports.storage,
  cipher,
  consequences,
  // T016 of specs/004-sessions: the outages' reclassification checks completion (T015) through the
  // one `EnrollmentSide` above, and logs a completion and a refusal.
  enrollmentSide,
  // T073 of specs/004-sessions: the restore's ninth cause `refunded`, payments' read handed in.
  enrollmentPayments: { refundedOf: payments.refundedOf },
  // T081 of specs/004-sessions (FR-512): `users.delete`, identity's deletion without the
  // re-authentication and without T080's check, on the administrator's transaction.
  userDeletion: services.identity.deletion,
  // T004 of specs/005-certification (FR-602): `users.setCertificateName`, identity's certificate-name
  // service on the administrator's transaction.
  certificateNames: services.identity.certificateName,
  // T006 of specs/005-certification (P4 (a), Q-A4 (a)): `credentials.correct` re-freezes the
  // corrected credential's open requests on its own transaction, after its conditional write.
  openRequestsRefreeze: {
    refreeze: (tx, credentialId) => ijazahRequests.refreeze(tx, credentialId),
  },
  log,
  // B39 (the notes under T059 and T064; the owner's decision of 2026-11-11): the kernel's idempotency,
  // keyed on the administrator kind's transaction (`runOn`), for `disputes.revise`,
  // `sessions.review.revise` and `cases.openManual`.
  idempotency,
  // T040 of specs/004-sessions: the two ports of the reads inside an open matter (contracts/kernel.md,
  // "The composition root"), so sessions imports neither verification nor chat (R-301).
  disputeHeldFiles: verification.createDisputeHeldFiles({
    database,
    storage: ports.storage,
    cipher,
    settings,
  }),
  disputeChat: chat.createDisputeChat({ enrollments: enrollmentSide, settings }),
  inviteQueue: {
    queue: async (adminId) => {
      await queue().add(DELIVER_ADMIN_INVITE, { adminId });
    },
  },
  // 003:T109 (Q-B4 (a)): the console's «نسخة تجريبية» reads the mode from `home.summary`.
  paymentMode: config.PAYMENT_MODE,
  // T007 of specs/005-certification (Q6 (a)): `ijazahRequests.approve` enqueues generation 0's render
  // after its commit; T032's `ijazahs.rerender` the raised generation (the queue above).
  ijazahRenders: certificateRenders,
  // 005:T013 to T015 (B47; Q-G1 (a)): the administrators' `genderFlags.*`, over the same flag service
  // as the user surface's; the correction's hold release reads payments' order standing (Q-G2 (c)).
  genderFlags,
  orders: payments.orderStandingsOf,
});
// 005:T034 (R1a; SRS FR-SESS-13 as amended, DEC-100; the note under T034): `reports.chat`, an open
// report's enrollment chat, over moderation's `ReportChat` port bound here to chat's
// `createDisputeChat()`, as sessions' `disputeChat` is above, so moderation imports no chat.
const reportChat = moderation.createReportChat({
  chat: chat.createDisputeChat({ enrollments: enrollmentSide, settings }),
});
// 005:T011 (B47): the administrators' `reports.*`, the same report service as the user surface's;
// 005:T034: and `reports.chat`, the read above.
const adminServices = {
  ...adminModuleServices,
  reports: { ...userReports, ...reportChat },
  // 003:T105: `payouts.*`, the service above.
  payouts: payouts.admin,
};

const application = await createApplication({
  log,
  // T063: the bus every request's publisher sends on, and the registry `live.events` opens in.
  live: { bus: liveBus, registry: liveRegistry },
  readiness: new ReadinessRepository(database),
  securityHeaders: { allowedOrigins: config.ADMIN_ALLOWED_ORIGINS, mode: config.NODE_ENV },
  maxRequestBodyBytes: config.MAX_REQUEST_BODY_BYTES,
  administration,
  rateLimiter,
  sessions,
  services,
  adminServices,
  // The public pages (T019, ADR 0021 D5): the Terms (T039) and the web deletion pages (T083).
  webRoutes: {
    [TERMS_PATH]: termsRoute({ settings }),
    ...identity.deleteAccountRoutes({
      deletion: services.identity.deletion,
      supportEmail: config.SUPPORT_EMAIL,
      rateLimiter,
    }),
  },
  routes,
  // The one proxy header whose last hop is the client's address, from the proxy's own address;
  // unset before a host is chosen.
  ...trustedProxy,
});
await application.listen(config.PORT);
log.info({ port: config.PORT }, 'Listening');

// Once, however many signals arrive: every live stream ended first (T063, FR-429, the owner's
// hard condition: `server.close()` would wait on an open stream), then the application stops
// listening and closes (Nest's shutdown hooks hear it), then the queue when an add opened it
// (T067, T038), then the database; exit 0 when all closed, 1 when any failed (T173).
onShutdown(
  apiStopSequence({
    live: liveRegistry,
    application,
    afterwards: [() => jobQueue?.close(), () => closeDatabase(database)],
  }),
  { log },
);
