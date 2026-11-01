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
// (T066), the stores of deleted people's files for `erase-deleted-files` (B16), every sweep
// registered on its schedule, and the queue's deliveries run through the
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
  { selectPorts, selectPushPort },
  queueing,
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
  import('./platform/ports/ports.module.js'),
  import('./jobs/queue.js'),
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
const ports = selectPorts(config);
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

// Every job the worker runs, each handed what it reads. A job is added here by the task that writes it.
const jobs: readonly Job[] = [
  expireIdempotencyKeys(idempotency),
  reencryptColumns({ cipher, columns: encryptedColumns, log }),
  purgeOtpCodes({ store: purge.otpCodes, settings }),
  purgeStalePushTokens({ store: purge.pushTokens, settings }),
  purgeExpiredSessions({ stores: { user: purge.userSessions, admin: adminSessions }, settings }),
  purgeUnreferencedDocuments({ store: unreferencedDocuments, storage: ports.storage, settings }),
  eraseDeletedFiles({ stores: erasedFiles, storage: ports.storage }),
  deliverAdminInvite({ invites: adminInvites, email: ports.email, marks: inviteMarks }),
];

const connection = queueing.connectionFor(config.REDIS_URL);
const queue = queueing.openQueue(connection);
await queueing.scheduleSweeps(queue, jobs);
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
