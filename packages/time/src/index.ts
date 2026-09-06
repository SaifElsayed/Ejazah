// T032: the time package over @js-temporal/polyfill. The public surface exposes the project's own
// types and never a Temporal object (FR-017, research R-4). Two distinct concepts, never conflated:
//   wall-clock in a zone (availability_slots.start_time_local + timezone)
//   absolute instant     (sessions.scheduled_start_at)
export * from './resolve.js';
