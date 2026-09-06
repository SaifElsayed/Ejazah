// PUBLIC ENTRY of the payments module (ADR 0007 D4). Other modules import this file and nothing below it (R-API-3).
// Owns payments and payment_events; hosts the raw-body webhook endpoint outside tRPC; runs confirm-enrollment
// and expire-pending-payments. Confirms an enrollment through booking's public entry; never writes enrollments itself.
export {};
