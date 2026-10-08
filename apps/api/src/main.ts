// Request process entrypoint (T008, T149). HTTP only. Refuses traffic until configuration validates
// (FR-039).
//
// `loadConfigOrExit` is the first call (note under T015): on an invalid configuration the process
// exits 1 naming the offending keys before anything is built, logged or listening (T093). Everything
// else is loaded only after it returns, so a refusal loads nothing but the configuration schema and
// stays quick. Then reporting is started (T111), the logger created (T100), the database client
// opened (T102), the admin module's settings reader bound (T113), and the application with both
// surfaces mounted (T149) made to listen.
import { loadConfigOrExit } from './platform/config/config.module.js';

const config = loadConfigOrExit();

const [
  { initReporting },
  { createLogger },
  { openDatabase },
  { requireSettingsReader },
  { createSettingsReader },
  { createApplication },
] = await Promise.all([
  import('./platform/errors/reporting.js'),
  import('./platform/logging/logger.js'),
  import('./platform/db/prisma.repository.js'),
  import('./platform/settings/settings-reader.js'),
  import('./modules/admin/index.js'),
  import('./app.module.js'),
]);

initReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const log = createLogger({ level: config.LOG_LEVEL });
const database = openDatabase(config.DATABASE_URL);

// Every operational number is read through this reader (FR-034); the process refuses to start
// without one. It is handed to each kernel part that reads settings as that part arrives (T103's
// rate limits, the idempotent procedures of the surfaces). No key is read here: the store is empty
// until the seed (T074), and an empty store must not stop the process booting.
const settings = requireSettingsReader(createSettingsReader(database));

const application = await createApplication({ log });
await application.listen(config.PORT);
log.info({ port: config.PORT }, 'Listening');
