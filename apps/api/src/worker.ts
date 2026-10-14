// Queue process entrypoint (T008, T112). Imports the SAME modules as main.ts so no background job
// carries its own divergent copy of a rule. Every job satisfies a double-run assertion (R-API-14, FR-052).
//
// `loadConfigOrExit` is the first call (note under T015), so the worker refuses an invalid
// configuration exactly as the request process does (T093). Everything else is loaded only after it
// returns. Then reporting is started (T111), the logger created (T100), the database client opened
// (T102), the admin module's settings reader bound (T113), each port's provider selected (T121),
// the column cipher and every `_encrypted` column bound for the re-encryption sweep (T155), every
// sweep registered on its schedule, and the queue's deliveries run through the registered jobs
// (T112).
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
  { createColumnCipher },
  { IdempotencyService },
  { IdempotencyRepository },
  { expireIdempotencyKeys },
  { reencryptColumns },
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
  import('./platform/crypto/encryption.js'),
  import('./platform/idempotency/idempotency.service.js'),
  import('./platform/idempotency/idempotency.repository.js'),
  import('./jobs/expire-idempotency-keys.js'),
  import('./jobs/reencrypt-columns.js'),
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
];

// Every job the worker runs, each handed what it reads. A job is added here by the task that writes it.
const jobs: readonly Job[] = [
  expireIdempotencyKeys(idempotency),
  reencryptColumns({ cipher, columns: encryptedColumns, log }),
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
