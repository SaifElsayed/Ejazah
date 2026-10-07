// Request process entrypoint (T008, T149). HTTP only. Refuses traffic until configuration validates
// (FR-039).
//
// `loadConfigOrExit` is the first call (note under T015): on an invalid configuration the process
// exits 1 naming the offending keys before anything is built, logged or listening (T093). Only then
// is reporting started (T111), the logger created (T100), and the application with both surfaces
// mounted (T149) made to listen.
import { createApplication } from './app.module.js';
import { loadConfigOrExit } from './platform/config/config.module.js';
import { initReporting } from './platform/errors/reporting.js';
import { createLogger } from './platform/logging/logger.js';

const config = loadConfigOrExit();
initReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const log = createLogger({ level: config.LOG_LEVEL });

const application = await createApplication({ log });
await application.listen(config.PORT);
log.info({ port: config.PORT }, 'Listening');
