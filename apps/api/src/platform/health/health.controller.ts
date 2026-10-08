// T110: liveness (is the process running) and readiness (can it serve) as separate endpoints
// (FR-051; contracts/kernel.md "Health signals"; ARCHITECTURE §12).
//
// `GET /health` never consults a dependency, so a database outage takes the process out of
// rotation rather than having it restarted in a loop. `GET /ready` runs the readiness query
// (`platform/db/readiness.repository.ts`) and answers 503 while it fails. Both are plain HTTP
// routes outside the two tRPC surfaces and need no session: the orchestrator calls them.
//
// FIXED BODIES. `{ status }` and a status code, 200 or 503, nothing else: no version, host name or
// dependency error text, since anyone can call these. A failed readiness check is caught here and
// is the answer; it never reaches the one error shape as an unexpected error, nor error reporting,
// and it is not logged, because the probe calls this every few seconds while a dependency is down.
//
// The readiness check is injected by an explicit token rather than by its class: the test runner
// transforms without decorator metadata (note under T149), so injection by class gets nothing.
import type { ServerResponse } from 'node:http';
import { Controller, Get, Inject, Res } from '@nestjs/common';

/** What readiness asks of the database; `ReadinessRepository` answers it. */
export interface Readiness {
  /** Resolves when the database answers a query, rejects otherwise. */
  databaseReachable(): Promise<void>;
}

export const READINESS = Symbol('Readiness');

type HealthStatus = 'ok' | 'ready' | 'unavailable';

function answer(response: ServerResponse, statusCode: 200 | 503, status: HealthStatus): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ status }));
}

@Controller()
export class HealthController {
  readonly #readiness: Readiness;

  constructor(@Inject(READINESS) readiness: Readiness) {
    this.#readiness = readiness;
  }

  @Get('health')
  health(@Res() response: ServerResponse): void {
    answer(response, 200, 'ok');
  }

  @Get('ready')
  async ready(@Res() response: ServerResponse): Promise<void> {
    try {
      await this.#readiness.databaseReachable();
    } catch {
      answer(response, 503, 'unavailable');
      return;
    }
    answer(response, 200, 'ready');
  }
}
