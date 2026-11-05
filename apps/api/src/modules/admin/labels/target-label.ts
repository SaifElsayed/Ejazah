// T021: the audit entry's target label, rendered once at write time from the target's type and
// identifier (FR-180, ADR 0021 D2, research R-108; ERD §12 `audit_logs.target_label`, §15 rule 29).
//
// THE LABEL IS NEVER A NAME AND NEVER TYPED TEXT, by construction: this function takes a type and
// an identifier and nothing else, the type selects a kind word from the table below, and the
// identifier must look like one (a UUID, a public number, a settings key: letters, digits and
// `_ . : -`), so a display name, a note or any other text a person wrote cannot pass through it.
// The audit writer calls it itself from `targetType` and `targetId` (`audit.repository.ts`); a
// handler cannot pass a label (`AuditEntry` has no such field, and cannot carry one).
//
// The kind words are Arabic, the log's one language (ADR 0021 D2): the admin pages show the stored
// label and, beside it, the target's current name resolved at read time (`target-name.ts`).
//
// An empty, unknown or over-long result is refused by throwing before the insert, and the
// administrator caller kind rolls the action back with it (FR-180: the writer keeps nothing of the
// action). The length bound is the contracts package's, which the database's check reads too.
import { AUDIT_LABEL_MAX_LENGTH } from '@ijazah/contracts';

/** What an audit entry may point at in this phase (admin-surface.md; ADR 0021 D2). */
export type AuditTargetType =
  | 'user'
  | 'teacher_application'
  | 'credential'
  | 'document'
  | 'verification_request'
  | 'admin'
  | 'setting'
  | 'payment';

/** The kind word of each target type: the label is this word, the separator and the identifier. */
export const auditTargetKinds: Readonly<Record<AuditTargetType, string>> = {
  user: 'حساب',
  teacher_application: 'طلب انضمام',
  credential: 'إجازة معلم',
  document: 'وثيقة',
  verification_request: 'طلب إثبات هوية',
  admin: 'مشرف',
  setting: 'إعداد',
  // T052: a gateway order the payments monitor opened (`payments.viewed`).
  payment: 'طلب دفع',
};

/** Between the kind word and the identifier (ERD §12). */
export const LABEL_SEPARATOR = ' · ';

/** An identifier as the label admits one; anything a person could have typed is not one. */
const IDENTIFIER = /^[A-Za-z0-9_.:-]+$/;

/** The writer's refusal: thrown before any insert, so the action rolls back (FR-180). */
export class TargetLabelError extends Error {
  constructor(reason: string) {
    super(`The audit target label was refused: ${reason} (FR-180, ADR 0021 D2).`);
    this.name = 'TargetLabelError';
  }
}

export function isAuditTargetType(type: string): type is AuditTargetType {
  return Object.hasOwn(auditTargetKinds, type);
}

/** The label of one target: its kind word and its identifier, or a refusal. */
export function targetLabel(type: string, id: string): string {
  if (!isAuditTargetType(type)) throw new TargetLabelError(`unknown target type "${type}"`);
  if (!IDENTIFIER.test(id)) throw new TargetLabelError('the identifier is empty or is not one');
  const label = `${auditTargetKinds[type]}${LABEL_SEPARATOR}${id}`;
  if (label.length > AUDIT_LABEL_MAX_LENGTH) {
    throw new TargetLabelError(`longer than ${AUDIT_LABEL_MAX_LENGTH} characters`);
  }
  return label;
}
