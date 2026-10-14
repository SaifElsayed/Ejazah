// Request process entrypoint (T008, T149). HTTP only. Refuses traffic until configuration validates
// (FR-039).
//
// `loadConfigOrExit` is the first call (note under T015): on an invalid configuration the process
// exits 1 naming the offending keys before anything is built, logged or listening (T093). Everything
// else is loaded only after it returns, so a refusal loads nothing but the configuration schema and
// stays quick. Then reporting is started (T111), the logger created (T100), the database client
// opened (T102), the admin module's settings reader bound (T113), the rate limiter built over it
// (T103), the admin module's audit writer bound (T108), each port's provider selected (T121), and the application with both surfaces mounted (T149) and the health routes registered
// (T110) made to listen.
import { loadConfigOrExit } from './platform/config/config.module.js';

const config = loadConfigOrExit();

const [
  { initReporting },
  { createLogger },
  { openDatabase },
  { ReadinessRepository },
  { requireSettingsReader },
  { createRateLimiter },
  { transactionsOver },
  { requireAuditWriter },
  { createAuditWriter, createSettingsReader },
  { selectPorts },
  { createApplication },
] = await Promise.all([
  import('./platform/errors/reporting.js'),
  import('./platform/logging/logger.js'),
  import('./platform/db/prisma.repository.js'),
  import('./platform/db/readiness.repository.js'),
  import('./platform/settings/settings-reader.js'),
  import('./platform/guards/rate-limit.guard.js'),
  import('./platform/db/transaction.repository.js'),
  import('./platform/audit/audit-writer.js'),
  import('./modules/admin/index.js'),
  import('./platform/ports/ports.module.js'),
  import('./app.module.js'),
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
const ports = selectPorts(config);

const application = await createApplication({
  log,
  readiness: new ReadinessRepository(database),
  securityHeaders: { allowedOrigins: config.ADMIN_ALLOWED_ORIGINS, mode: config.NODE_ENV },
  maxRequestBodyBytes: config.MAX_REQUEST_BODY_BYTES,
  administration,
  rateLimiter,
});
await application.listen(config.PORT);
log.info({ port: config.PORT }, 'Listening');
