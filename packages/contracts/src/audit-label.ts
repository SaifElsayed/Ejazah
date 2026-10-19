// T021: the one bound on an audit entry's target label (FR-180, ADR 0021 D2, ERD §15 rule 29).
// The writer refuses a longer label before the insert, and the database's check constraint refuses
// it again; both read this number, so the two cannot drift apart.

/** The longest `audit_logs.target_label` the writer renders and the database admits. */
export const AUDIT_LABEL_MAX_LENGTH = 200;
