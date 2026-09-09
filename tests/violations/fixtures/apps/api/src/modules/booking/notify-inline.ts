// T027 fixture — VIOLATION of R-API-15: a booking module file reaches the push port and sends a
// notification inline, in the request path, instead of enqueueing the `deliver-notification`
// job under apps/api/src/jobs/ that the worker runs with retry (FR-NOTIF-4). The import is the
// port's public entry, not a concrete adapter, so `boundaries/no-adapter-import` (R-API-4) has
// nothing to say about it and the only prohibition this file breaks is the inline delivery.
// Refused by api/no-push-outside-job.
import { push } from '../../platform/ports/push/push.port';

export async function notifyEnrollmentConfirmed(
  studentId: string,
  enrollmentId: string,
): Promise<void> {
  await push.send(studentId, { kind: 'enrollment_confirmed', id: enrollmentId });
}
