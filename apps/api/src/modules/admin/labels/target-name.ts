// T021: the target's current name, resolved at read time beside the stored label (FR-181, ADR 0021
// D2, research R-108), and the Arabic that was the admin catalogue's three keys.
//
// The stored label never carries a name (`target-label.ts`); the admin pages show the name next to
// it, read when the page is read, so a renamed person reads under the new name and a deleted one
// under the role word (student, teacher), never under a name that no longer exists. The person is
// read through the identity module's public entry (R-API-3), the administrator through this
// module's own repository.
//
// THE FUSED FORM. Arabic joins «لـ» to a name; before the definite article «ال» the two fuse into
// «لل» («لـ» + «المعلم» → «للمعلم»). The three catalogue keys that carried this form
// (`admin.audit.targets.*`, `admin.credentials.a11y.documentPage`, `admin.dialogs.mfaReset.title`)
// live here now, as functions over the names, so one place owns the Arabic and the parity check
// of `apps/admin/src/i18n/` no longer sees them (ADR 0021 D2, research R-108).
//
// Types this phase stores but whose owner is another module's row (a credential, a document, a
// verification request) or no person at all (a setting) resolve to no name here; the audit query
// that lists them (T066) adds the owner's name when it joins the owning module's entry.
import type { Transaction } from '../../../platform/db/prisma.repository.js';
import { readTargetPerson, type TargetPerson } from '../../identity/index.js';
import { readAdministratorName } from '../admin-users.repository.js';
import type { AuditTargetType } from './target-label.js';

/** The word shown for a deleted person, by the role the account held. */
export const roleWords = {
  student: 'طالب',
  teacher: 'معلم',
  unknown: 'مستخدم',
} as const;

/** «لـ» joined to a name; fused into «لل» before the definite article. */
export function withLam(name: string): string {
  const article = 'ال';
  return name.startsWith(article) ? `لل${name.slice(article.length)}` : `لـ${name}`;
}

/** The Arabic the admin catalogue's three keys carried, as functions over the names. */
export const arabic = {
  /** `admin.audit.targets.application` */
  application: (name: string): string => `طلب انضمام ${name}`,
  /** `admin.audit.targets.chatReport` */
  chatReport: (): string => 'بلاغ محادثة',
  /** `admin.audit.targets.credential` */
  credential: (subject: string, teacher: string): string => `إجازة ${subject} · ${teacher}`,
  /** `admin.audit.targets.ijazah` */
  ijazah: (student: string, code: string): string => `إجازة ${student} · ${code}`,
  /** `admin.audit.targets.review` */
  review: (student: string, teacher: string): string => `تقييم ${student} ${withLam(teacher)}`,
  /** `admin.credentials.a11y.documentPage` */
  documentPage: (subject: string, teacher: string, page: number): string =>
    `إجازة ${subject} ${withLam(teacher)}، الصفحة ${page}`,
  /** `admin.dialogs.mfaReset.title` */
  mfaResetTitle: (name: string): string => `إعادة ضبط التحقق بخطوتين ${withLam(name)}`,
} as const;

/** The name a person reads under: the display name, or the role word once the row is deleted. */
export function personName(person: TargetPerson): string {
  if (person.deleted || person.displayName === null) return roleWords[person.role ?? 'unknown'];
  return person.displayName;
}

/** Where the names are read from; the real readers unless a spec hands in its own. */
export interface TargetNameReaders {
  readonly person: (tx: Transaction, userId: string) => Promise<TargetPerson | null>;
  readonly administrator: (tx: Transaction, adminId: string) => Promise<string | null>;
}

const readers: TargetNameReaders = {
  person: readTargetPerson,
  administrator: readAdministratorName,
};

/**
 * The target's current name, or null when the type names no person this module can read. Runs
 * on the reading transaction, at read time, never at write time.
 */
export async function resolveTargetName(
  tx: Transaction,
  type: AuditTargetType,
  id: string,
  from: TargetNameReaders = readers,
): Promise<string | null> {
  switch (type) {
    case 'user':
    case 'teacher_application': {
      const person = await from.person(tx, id);
      return person === null ? null : personName(person);
    }
    case 'admin':
      return from.administrator(tx, id);
    case 'credential':
    case 'document':
    case 'verification_request':
    case 'setting':
    case 'payment':
      return null;
  }
}
