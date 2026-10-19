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
  { onShutdown },
  { ReadinessRepository },
  { requireSettingsReader },
  { createRateLimiter },
  { transactionsOver },
  { requireAuditWriter },
  { createAuditWriter, createSettingsReader },
  catalog,
  identity,
  verification,
  { createColumnCipher },
  { selectPorts },
  { TERMS_PATH, termsRoute },
  { createApplication },
] = await Promise.all([
  import('./platform/errors/reporting.js'),
  import('./platform/logging/logger.js'),
  import('./platform/db/prisma.repository.js'),
  import('./platform/lifecycle/shutdown.js'),
  import('./platform/db/readiness.repository.js'),
  import('./platform/settings/settings-reader.js'),
  import('./platform/guards/rate-limit.guard.js'),
  import('./platform/db/transaction.repository.js'),
  import('./platform/audit/audit-writer.js'),
  import('./modules/admin/index.js'),
  import('./modules/catalog/index.js'),
  import('./modules/identity/index.js'),
  import('./modules/verification/index.js'),
  import('./platform/crypto/encryption.js'),
  import('./platform/ports/ports.module.js'),
  import('./platform/web/terms/terms.controller.js'),
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

// Stand-in session resolvers (T017): every request is anonymous until the identity module's
// `resolveUserSession` (T047) and the admin module's `resolveAdminSession` (T066) replace them.
// Each answers null, as a resolver does for a token it does not know (kernel.md "Session
// resolution"), so the built entrypoint boots and serves exactly what it served before.
const sessions = {
  user: async () => null,
  admin: async () => null,
};

// What the user surface's procedures read (T038): the settings reader, the support address from
// the configuration (FR-145, never an admin setting) and the catalog module's subjects read.
const services = {
  settings,
  publicConfig: { supportEmail: config.SUPPORT_EMAIL },
  subjects: catalog.createSubjectsService(database),
};

// The two upload routes (T024, public-pages.md "The uploads route"), each over the surfaces' upload
// helper with the user session resolver, T020's guard and the storage port; the documents route
// encrypts its key with the column cipher (R-DB-8).
const uploads = {
  sessions: sessions.user,
  guard: { settings, rateLimiter },
  log,
  ...(config.TRUSTED_PROXY === undefined ? {} : { trustedProxyHeader: config.TRUSTED_PROXY }),
};
const routes = {
  [verification.DOCUMENTS_UPLOAD_PATH]: verification.createDocumentsUploadRoute({
    ...uploads,
    storage: ports.storage,
    cipher: createColumnCipher(config),
    database,
  }),
  [identity.PHOTOS_UPLOAD_PATH]: identity.createPhotoUploadRoute({
    ...uploads,
    storage: ports.storage,
    settings,
    database,
  }),
};

const application = await createApplication({
  log,
  readiness: new ReadinessRepository(database),
  securityHeaders: { allowedOrigins: config.ADMIN_ALLOWED_ORIGINS, mode: config.NODE_ENV },
  maxRequestBodyBytes: config.MAX_REQUEST_BODY_BYTES,
  administration,
  rateLimiter,
  sessions,
  services,
  // The public pages (T019, ADR 0021 D5): the Terms (T039); the deletion pages join with T052.
  webRoutes: { [TERMS_PATH]: termsRoute({ settings }) },
  routes,
  // The one proxy header whose last hop is the client's address; unset before a host is chosen.
  ...(config.TRUSTED_PROXY === undefined ? {} : { trustedProxyHeader: config.TRUSTED_PROXY }),
});
await application.listen(config.PORT);
log.info({ port: config.PORT }, 'Listening');

// Once, however many signals arrive: stop listening and close the application (Nest's shutdown
// hooks are enabled by the application, so its providers hear it too), then close the database;
// exit 0 when both closed, 1 when either failed (T173).
onShutdown(
  async () => {
    await application.close();
    await closeDatabase(database);
  },
  { log },
);
