// Queue process entrypoint (T008, T112). Imports the SAME modules as main.ts so no background job
// carries its own divergent copy of a rule. Every job satisfies a double-run assertion (R-API-14, FR-052).
//
// `loadConfigOrExit` is the first call (note under T015), so the worker refuses an invalid
// configuration exactly as the request process does (T093). The queue built on it is T112's.
import { loadConfigOrExit } from './platform/config/config.module.js';

loadConfigOrExit();
