// Queue process entrypoint (T008, T112). Imports the SAME modules as main.ts so no background job
// carries its own divergent copy of a rule. Every job satisfies a double-run assertion (R-API-14, FR-052).
//
// `loadConfigOrExit` is the first call (note under T015), so the worker refuses an invalid
// configuration exactly as the request process does (T093). Everything else is loaded only after it
// returns. Then reporting is started (T111), the logger created (T100), every sweep registered on
// its schedule, and the queue's deliveries run through the registered jobs (T112).
//
// The worker is a plain composition, not a Nest application context: no job resolves anything by
// injection, so each is handed what it needs here, and `dev:worker` runs this file under `tsx`.
import { loadConfigOrExit } from './platform/config/config.module.js';
import type { Job } from './jobs/job.js';

const config = loadConfigOrExit();

const [{ initReporting }, { createLogger }, queueing] = await Promise.all([
  import('./platform/errors/reporting.js'),
  import('./platform/logging/logger.js'),
  import('./jobs/queue.js'),
]);

initReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const log = createLogger({ level: config.LOG_LEVEL });

// Every job the worker runs. A job is added here by the task that writes it.
const jobs: readonly Job[] = [];

const connection = queueing.connectionFor(config.REDIS_URL);
const queue = queueing.openQueue(connection);
await queueing.scheduleSweeps(queue, jobs);
const worker = queueing.startWorker({ connection, jobs, log });
log.info({ queue: queueing.QUEUE_NAME, jobs: jobs.length }, 'Worker started');

// A deploy stops the process with SIGTERM: the running delivery finishes before the worker closes,
// and an unfinished one is delivered again, which is safe because every job is idempotent.
async function stop(signal: NodeJS.Signals): Promise<void> {
  log.info({ signal }, 'Worker stopping');
  await worker.close();
  await queue.close();
  process.exit(0);
}

process.once('SIGTERM', (signal) => void stop(signal));
process.once('SIGINT', (signal) => void stop(signal));
