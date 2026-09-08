// T020 fixture — VIOLATION of R-API-4, upward half: a domain module imports the administrative
// module. Dependencies point inward, and nothing points at admin.
// Refused by boundaries/no-upward-admin-import.
import { auditLogIds } from '../admin';

export function auditTrailForBooking(): readonly string[] {
  return auditLogIds();
}
