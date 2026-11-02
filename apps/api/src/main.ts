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
  { connectionFor, openQueue },
  { DELIVER_ADMIN_INVITE },
  { filesRoutes },
  payments,
  { standInCheckoutRoutes },
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
// (T020, R-207): catalog asks whether a slot or a package is in use without importing booking.
// The one registry of an account's end (FR-142): the admin module's standing actions and the
// identity module's deletion call it, and the modules that keep what an account had subscribe to it
// (B16 check, decision 2). The verification module subscribes the erasure of a deleted person's
// documents, and its file erasure removes their files after the deletion's commit (decision 1).
const consequences = new identity.AccountConsequences();
consequences.subscribe(verification.documentErasureConsequence());
const idempotency = new IdempotencyService({
  store: new IdempotencyRepository(database),
  settings,
});
const services = {
  settings,
  publicConfig: { supportEmail: config.SUPPORT_EMAIL },
  subjects: catalog.createSubjectsService(database),
  identity: identity.createIdentityServices({
    ...identityBase,
    cipher,
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
    ],
  }),
  verification: verification.createVerificationServices({
    database,
    storage: ports.storage,
    cipher,
    settings,
    idempotency,
  }),
  catalog: catalog.createCatalogServices({
    use: {
      slotInUse: booking.slotInUse,
      packageHasEnrollment: booking.packageHasEnrollment,
    },
  }),
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
  }),
  ...filesRoutes(ports.storage),
  // The gateway's signed webhook (T077): its raw body read under the request limit, verified by the
  // payment port, and a recipient event recorded and handed to identity's entries (R-121).
  [payments.PAYMENT_WEBHOOK_PATH]: payments.createPaymentWebhookRoute({
    database,
    payment: ports.payment,
    log,
    maxBodyBytes: config.MAX_REQUEST_BODY_BYTES,
  }),
  // The stand-in's hosted page (T012, R-213): a route only while the payment port is the stand-in
  // (`PAYMENT_GATEWAY=fake`); it posts its signed events to the webhook above over HTTP.
  ...standInCheckoutRoutes({
    payment: ports.payment,
    rateLimiter,
    log,
    ...(config.TRUSTED_PROXY === undefined ? {} : { trustedProxyHeader: config.TRUSTED_PROXY }),
  }),
};

// The admin module's services behind the administrator surface (T067), bound to the surface's port.
// `admins.add` queues `deliver-admin-invite` with the id alone (R-110); the queue is opened on the
// first add, so a process that never adds an administrator never connects to it for that.
let inviteQueue: ReturnType<typeof openQueue> | undefined;
const adminServices = createAdminServices({
  database,
  settings,
  encryptionKey: config.ENCRYPTION_KEY,
  storage: ports.storage,
  cipher,
  consequences,
  inviteQueue: {
    queue: async (adminId) => {
      inviteQueue ??= openQueue(connectionFor(config.REDIS_URL));
      await inviteQueue.add(DELIVER_ADMIN_INVITE, { adminId });
    },
  },
});

const application = await createApplication({
  log,
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
  // The one proxy header whose last hop is the client's address; unset before a host is chosen.
  ...(config.TRUSTED_PROXY === undefined ? {} : { trustedProxyHeader: config.TRUSTED_PROXY }),
});
await application.listen(config.PORT);
log.info({ port: config.PORT }, 'Listening');

// Once, however many signals arrive: stop listening and close the application (Nest's shutdown
// hooks are enabled by the application, so its providers hear it too), then the invite queue when
// an add opened it (T067), then the database; exit 0 when all closed, 1 when any failed (T173).
onShutdown(
  async () => {
    await application.close();
    await inviteQueue?.close();
    await closeDatabase(database);
  },
  { log },
);
