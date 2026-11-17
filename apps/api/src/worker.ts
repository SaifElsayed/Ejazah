// Queue process entrypoint (T008, T112). Imports the SAME modules as main.ts so no background job
// carries its own divergent copy of a rule. Every job satisfies a double-run assertion (R-API-14, FR-052).
//
// `loadConfigOrExit` is the first call (note under T015), so the worker refuses an invalid
// configuration exactly as the request process does (T093). Everything else is loaded only after it
// returns. Then reporting is started (T111), the logger created (T100), the database client opened
// (T102), the admin module's settings reader bound (T113), each port's provider selected (T121),
// the column cipher and every `_encrypted` column bound for the re-encryption sweep (T155), the
// purge stores of both modules bound for the three purge sweeps (T025), the verification module's
// store of unreferenced documents over the identity and catalog modules' pointers (Phase 1's T093),
// the admin module's invites with the email port and the invite marks for `deliver-admin-invite`
// (T066), the stores of deleted people's files for `erase-deleted-files` (B16), `confirm-enrollment`
// over the database and the settings reader (T039), the two expiry sweeps (T040), the time zone
// re-resolution over the kernel's record of its runs, added once at start (T048), `evaluate-sessions`
// over sessions' completion and booking's `EnrollmentSide` (T014, T015), every sweep registered on
// its schedule, and the queue's deliveries run through the
// registered jobs (T112).
//
// The worker is a plain composition, not a Nest application context: no job resolves anything by
// injection, so each is handed what it needs here, and `dev:worker` runs this file under `tsx`.
import { loadConfigOrExit } from './platform/config/config.module.js';
import type { Job } from './jobs/job.js';

const config = loadConfigOrExit();

const [
  { initReporting },
  { createLogger },
  { closeDatabase, openDatabase },
  { onShutdown },
  { requireSettingsReader },
  admin,
  identity,
  verification,
  payments,
  { createColumnCipher },
  { IdempotencyService },
  { IdempotencyRepository },
  { expireIdempotencyKeys },
  { reencryptColumns },
  { purgeOtpCodes },
  { purgeStalePushTokens },
  { purgeExpiredSessions },
  { purgeUnreferencedDocuments },
  { eraseDeletedFiles },
  { deliverAdminInvite },
  { createRedisSingleUseMarks },
  catalog,
  booking,
  { selectPorts, selectPushPort },
  queueing,
  { CONFIRM_ENROLLMENT, confirmEnrollment },
  { expireHolds },
  { expirePendingPayments },
  { RERESOLVE_SESSION_INSTANTS, reresolveSessionInstants },
  { jobRunsOver },
  sessions,
  { evaluateSessions },
  { expireCancellationRequests },
  { advanceRemedies },
  { purgeChat },
  { closeSlotHolds },
  { eraseKeptData },
  // T005 of specs/005-certification: the push delivery job, its module and the generated copy.
  { deliverNotification, pushCopyRenderer },
  notifications,
  { copyOf },
  // T008 of specs/005-certification: the certificate's rendering.
  { certificateRenderSteps, renderCertificate },
] = await Promise.all([
  import('./platform/errors/reporting.js'),
  import('./platform/logging/logger.js'),
  import('./platform/db/prisma.repository.js'),
  import('./platform/lifecycle/shutdown.js'),
  import('./platform/settings/settings-reader.js'),
  import('./modules/admin/index.js'),
  import('./modules/identity/index.js'),
  import('./modules/verification/index.js'),
  import('./modules/payments/index.js'),
  import('./platform/crypto/encryption.js'),
  import('./platform/idempotency/idempotency.service.js'),
  import('./platform/idempotency/idempotency.repository.js'),
  import('./jobs/expire-idempotency-keys.js'),
  import('./jobs/reencrypt-columns.js'),
  import('./jobs/purge-otp-codes.js'),
  import('./jobs/purge-stale-push-tokens.js'),
  import('./jobs/purge-expired-sessions.js'),
  import('./jobs/purge-unreferenced-documents.js'),
  import('./jobs/erase-deleted-files.js'),
  import('./jobs/deliver-admin-invite.js'),
  import('./platform/redis/single-use-marks.js'),
  import('./modules/catalog/index.js'),
  import('./modules/booking/index.js'),
  import('./platform/ports/ports.module.js'),
  import('./jobs/queue.js'),
  import('./jobs/confirm-enrollment.js'),
  import('./jobs/expire-holds.js'),
  import('./jobs/expire-pending-payments.js'),
  import('./jobs/reresolve-session-instants.js'),
  import('./platform/idempotency/job-runs.repository.js'),
  import('./modules/sessions/index.js'),
  import('./jobs/evaluate-sessions.js'),
  import('./jobs/expire-cancellation-requests.js'),
  import('./jobs/advance-remedies.js'),
  import('./jobs/purge-chat.js'),
  import('./jobs/close-slot-holds.js'),
  import('./jobs/erase-kept-data.js'),
  import('./jobs/deliver-notification.js'),
  import('./modules/notifications/index.js'),
  import('./platform/web/copy.js'),
  import('./jobs/render-certificate.js'),
]);

initReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const log = createLogger({ level: config.LOG_LEVEL });
const database = openDatabase(config.DATABASE_URL, {
  poolMax: config.DATABASE_POOL_MAX,
  statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
  idleInTransactionTimeoutMs: config.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

// Every operational number a job reads comes through this reader (FR-034); the worker refuses to
// start without one. No key is read here: the store is empty until the seed (T074).
const settings = requireSettingsReader(admin.createSettingsReader(database));

// Each port's provider is chosen here, once, from the configuration (T121, FR-056), and handed to
// each job as it arrives. Push is the notification delivery job's alone (R-API-15).
// 003:T101 (track 2, B-M1): the payment gateway writes its warn line to the process's logger.
const ports = selectPorts(config, log);
const push = selectPushPort(config);

const idempotency = new IdempotencyService({
  store: new IdempotencyRepository(database),
  settings,
});

// The column cipher holds ENCRYPTION_KEY_PREVIOUS only while a rotation runs (T155); every
// `_encrypted` column comes from the module that owns its table (R-API-6).
const cipher = createColumnCipher(config);
const encryptedColumns = [
  ...admin.createEncryptedColumns(database),
  ...identity.createEncryptedColumns(database),
  ...verification.createEncryptedColumns(database),
  ...payments.createEncryptedColumns(database),
];

// The three purge sweeps (T025, FR-107) read their windows through the settings reader and delete
// through the stores of the modules that own the tables; the admin module's store is handed in
// here, as its column is, since a job may not import that module (R-API-4).
const purge = identity.createPurgeStores(database);
const adminSessions = admin.createAdminSessionPurgeStore(database);

// The unreferenced documents (T093): the verification module's store over the identity and catalog
// modules' pointers, the cipher decrypting each key for the one removal through the storage port.
const unreferencedDocuments = verification.createUnreferencedDocuments({
  database,
  cipher,
  references: [
    identity.createDocumentReferences(database),
    catalog.createDocumentReferences(database),
  ],
});

// A deleted person's files whose removal after the deletion's commit failed (B16, decision 1): the
// verification module's erased documents still holding a key and the identity module's deleted
// people still holding a photo key, each removed through the storage port before its key is cleared.
const erasedFiles = [
  verification.createDocumentErasure({ database, cipher, storage: ports.storage }),
  identity.createErasedPhotos(database),
];

// The administrator's invite (T066, R-110): the admin module prepares each mail, the link pointing
// at the panel's origin, and the job marks each one sent in Redis so a redelivery sends nothing more.
const adminInvites = admin.createAdminInvites({
  database,
  settings,
  encryptionKey: config.ENCRYPTION_KEY,
  panelOrigin: config.ADMIN_PANEL_ORIGIN,
});
const inviteMarks = createRedisSingleUseMarks({
  redisUrl: config.REDIS_URL,
  onError: (error) => log.warn({ err: error }, 'Single-use marks unreachable'),
});

// The queue, opened before the jobs: `expire-pending-payments` hands a paid order to
// `confirm-enrollment` on it, added under the payment's id or, when that job failed all its attempts,
// retried (`addOrRetry`, the owner's decision of 2026-11-03), as the webhook's enqueue in main.ts.
const connection = queueing.connectionFor(config.REDIS_URL);
const queue = queueing.openQueue(connection);
const confirmations = {
  enqueue: (paymentId: string) =>
    queueing.addOrRetry(
      queue,
      { name: CONFIRM_ENROLLMENT, data: { paymentId }, jobId: paymentId },
      log,
    ),
};

// Sessions' port to booking's enrollments (T008, the note under T015), bound once as main.ts binds
// it, and T015's completion check over it, which every path that settles calls.
const enrollmentSide = booking.createEnrollmentSide({ settings });
const completion = sessions.createCompletion({ enrollments: enrollmentSide, settings });

// Every job the worker runs, each handed what it reads. A job is added here by the task that writes it.
const jobs: readonly Job[] = [
  expireIdempotencyKeys(idempotency),
  reencryptColumns({ cipher, columns: encryptedColumns, log }),
  purgeOtpCodes({ store: purge.otpCodes, settings }),
  purgeStalePushTokens({ store: purge.pushTokens, settings }),
  purgeExpiredSessions({ stores: { user: purge.userSessions, admin: adminSessions }, settings }),
  purgeUnreferencedDocuments({ store: unreferencedDocuments, storage: ports.storage, settings }),
  // T004 of specs/004-sessions (FR-487): a held owner's files wait for the last open matter.
  eraseDeletedFiles({
    stores: erasedFiles,
    storage: ports.storage,
    held: (userIds) => booking.heldFileOwnersAmong(database, userIds),
  }),
  deliverAdminInvite({ invites: adminInvites, email: ports.email, marks: inviteMarks }),
  // A paid order's confirmation (T039, R-215): the modules' entries on the job's transactions, the
  // hold's terms and the first session's lead read through the settings reader.
  confirmEnrollment({ database, settings, log }),
  // The expiry sweeps (T040, FR-364), every minute: the holds with no enrollment, booking's; the
  // orders past their expiry, the holds with an enrollment, and the hand-off of a paid order whose
  // confirmation was lost, payments', reading `checkout_confirmation_timeout_seconds`.
  expireHolds({ database }),
  expirePendingPayments({ database, settings, confirmations }),
  // The time zone re-resolution (T048, R-210, ADR 0009 D3), daily and once at start below: it runs
  // when `process.versions.tz` differs from its last run's, kept by the kernel in `idempotency_keys`.
  reresolveSessionInstants({ database, runs: jobRunsOver(database), settings }),
  // The sessions' sweep (T014, R-306), every minute: a cancelled session's room ended in its join
  // period, then every session due settled under its enrollment's and its own locks, then (T067)
  // every room due a close at its scheduled end plus the grace ended.
  evaluateSessions({
    database,
    settings,
    enrollments: enrollmentSide,
    completion,
    video: ports.video,
    log,
  }),
  // The cancellation requests' expiry (T022 of specs/004-sessions, FR-458), every minute: a request
  // still pending at its session's start written expired under its enrollment's lock.
  expireCancellationRequests({ database, enrollments: enrollmentSide, log }),
  // The remedies' sweep (T028 of specs/004-sessions, FR-462 to FR-464), every minute: each session owed
  // a make-up offered its remedy once its outcome is final, frozen remedies offered again, and the
  // completion check, which an open student_suspended or admin_cancellation case holds (Q3 (a)).
  advanceRemedies({ database, settings, enrollments: enrollmentSide, completion, log }),
  // The chat purge (T039 of specs/004-sessions, FR-492), daily: each ended enrollment's chat once its
  // last disputable session's window and `chat_retention_days` have passed and nothing is open on
  // it, under its lock; the files removed after the commit and retried by the next run.
  purgeChat({ database, settings, storage: ports.storage, log }),
  // The held slots' hold ends (T074 of specs/004-sessions, FR-505), hourly at minute 35: each held
  // closing whose hold ran out by its date gets one `slot_hold_ended` row, under its enrollment's lock;
  // nothing else changes.
  closeSlotHolds({ database, settings, log }),
  // A deleted teacher's kept data erased on its date (T077 of specs/004-sessions, FR-509), daily at
  // 04:25 ⚠️ automatic and final: each profile whose `kept_erase_at` passed, one per transaction, under
  // its lock and its kept documents' locks; the files are left to `erase-deleted-files`.
  eraseKeptData({ database, log }),
  // T005 of specs/005-certification (FR-620, R-405, R-406): one notification's push, enqueued by the
  // writer after its producer's commit; idempotent on `pushed_at`; the kind's fixed text in the user's
  // language from the generated copy (checked at start: all 28 texts present); ⚠️ the tokens the
  // provider no longer accepts removed through identity, automatically and for good.
  deliverNotification({
    notifications: notifications.createNotificationDeliveries(database),
    recipients: identity.createPushRecipients({ database, cipher }),
    push,
    render: pushCopyRenderer({ ar: copyOf('ar'), en: copyOf('en') }),
    log,
  }),
  // T008 of specs/005-certification (FR-606, R-401; Q6 (a)): one ijazah's certificate, enqueued after
  // the approval's (T007) or the re-render's (T032) commit with its generation; the PDF under
  // `certificates/<ijazahId>/<generation>.pdf`, marked under the ijazah's lock only while that
  // generation is current. ⚠️ automatic: a newer generation's file replaces the older one, which is
  // removed after the commit; a missing signature copy leaves the ijazah unrendered (`signature_missing`).
  renderCertificate({
    steps: certificateRenderSteps(database),
    storage: ports.storage,
    typstBin: config.TYPST_BIN,
    log,
  }),
];

await queueing.scheduleSweeps(queue, jobs);
// ADR 0009 D3: the worker reads the time zone data version at its start, so the re-resolution runs
// once now, through the queue (its retries and failure reporting), besides its daily schedule.
await queue.add(RERESOLVE_SESSION_INSTANTS, {});
const worker = queueing.startWorker({
  connection,
  jobs,
  log,
  concurrency: config.QUEUE_CONCURRENCY,
});
log.info({ queue: queueing.QUEUE_NAME, jobs: jobs.length }, 'Worker started');

// A deploy stops the process with SIGTERM: the running delivery finishes before the worker closes,
// and an unfinished one is delivered again, which is safe because every job is idempotent. The
// sequence runs once however many signals arrive, and the process exits with its outcome (T173).
onShutdown(
  async () => {
    await worker.close();
    await queue.close();
    await closeDatabase(database);
  },
  { log },
);
