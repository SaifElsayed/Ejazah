// T033: per-occurrence recurrence resolution. Each occurrence is resolved from its own local date and
// the slot's local time in the teacher's zone, never by adding intervals (FR-018, R-TIME-2).
// Nonexistent local time shifts forward; ambiguous local time takes the first (FR-019, R-TIME-7).
export {};
