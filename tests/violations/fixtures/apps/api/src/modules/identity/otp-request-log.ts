// T026 fixture — VIOLATION of R-SEC-2: a logger call handed the raw request body, which for an
// OTP request carries the destination and the code. The prohibition covers the body itself, not
// a field picked out of it.
// Refused by sec/no-body-logging.
import { logger } from '../../platform/logging/logger';

export interface IncomingRequest {
  readonly body: unknown;
}

export function recordOtpRequest(req: IncomingRequest): void {
  logger.info('otp requested', req.body);
}
