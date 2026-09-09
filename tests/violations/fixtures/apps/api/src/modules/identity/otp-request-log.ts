// T026 fixture — VIOLATION of R-SEC-2: a logger call handed the raw request body. The body of an
// OTP request carries the destination and the code, and a log line is the one place a secret is
// copied somewhere nobody redacts later. The prohibition covers the body itself, not a field
// picked out of it, which is why the rule reads the argument rather than the record's shape.
// Nothing here is a router, a repository or a money position, so the layer and money rules stay
// silent and the only thing wrong is what reaches the logger.
// Refused by sec/no-body-logging.
import { logger } from '../../platform/logging/logger';

export interface IncomingRequest {
  readonly body: unknown;
}

export function recordOtpRequest(req: IncomingRequest): void {
  logger.info('otp requested', req.body);
}
