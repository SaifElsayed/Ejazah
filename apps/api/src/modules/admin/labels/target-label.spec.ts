// T021 — the audit label is never a name, bounded in length, and the read-time name carries the
// fused forms (FR-180, FR-181, ADR 0021 D2, research R-108).
import { AUDIT_LABEL_MAX_LENGTH } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type { TargetPerson } from '../../identity/index.js';
import {
  auditTargetKinds,
  LABEL_SEPARATOR,
  targetLabel,
  TargetLabelError,
} from './target-label.js';
import { arabic, personName, resolveTargetName, withLam } from './target-name.js';

const USER_ID = '0199d0a0-0000-7000-8000-000000000001';

describe('the target label (T021, FR-180)', () => {
  it('is the kind word and the identifier, for each type of this phase', () => {
    expect(targetLabel('user', USER_ID)).toBe(`حساب · ${USER_ID}`);
    expect(targetLabel('teacher_application', USER_ID)).toBe(`طلب انضمام · ${USER_ID}`);
    expect(targetLabel('credential', USER_ID)).toBe(`إجازة معلم · ${USER_ID}`);
    expect(targetLabel('document', USER_ID)).toBe(`وثيقة · ${USER_ID}`);
    expect(targetLabel('verification_request', USER_ID)).toBe(`طلب إثبات هوية · ${USER_ID}`);
    expect(targetLabel('admin', USER_ID)).toBe(`مشرف · ${USER_ID}`);
    expect(targetLabel('setting', 'rate_limit_search')).toBe('إعداد · rate_limit_search');
    // T052: the payments monitor's `payments.viewed` names the order it opened.
    expect(targetLabel('payment', USER_ID)).toBe(`طلب دفع · ${USER_ID}`);
    for (const [type, word] of Object.entries(auditTargetKinds)) {
      expect(targetLabel(type, 'x')).toBe(`${word}${LABEL_SEPARATOR}x`);
    }
  });

  it('never carries a name: it takes a type and an identifier only, and refuses text a person could have typed', () => {
    expect(targetLabel.length).toBe(2);
    for (const typed of ['Ahmed Ali', 'أحمد علي', 'a b', 'id;drop', 'x\ny', 'name@example']) {
      expect(() => targetLabel('user', typed)).toThrow(TargetLabelError);
    }
  });

  it('refuses an empty identifier and an unknown type', () => {
    expect(() => targetLabel('user', '')).toThrow(TargetLabelError);
    expect(() => targetLabel('user', '   ')).toThrow(TargetLabelError);
    expect(() => targetLabel('teacher_profile', USER_ID)).toThrow(/unknown target type/);
    expect(() => targetLabel('', USER_ID)).toThrow(TargetLabelError);
  });

  it('refuses a label over the contracts package’s bound, and accepts one at it', () => {
    const word = auditTargetKinds.setting;
    const room = AUDIT_LABEL_MAX_LENGTH - word.length - LABEL_SEPARATOR.length;
    expect(targetLabel('setting', 'k'.repeat(room))).toHaveLength(AUDIT_LABEL_MAX_LENGTH);
    expect(() => targetLabel('setting', 'k'.repeat(room + 1))).toThrow(/longer than 200/);
  });
});

describe('the read-time name and the fused forms (T021, FR-181)', () => {
  it('fuses «لـ» with the definite article and not otherwise', () => {
    expect(withLam('المعلم')).toBe('للمعلم');
    expect(withLam('الشيخ أحمد')).toBe('للشيخ أحمد');
    expect(withLam('أحمد')).toBe('لـأحمد');
    expect(arabic.documentPage('القراءات', 'المعلمة سارة', 3)).toBe(
      'إجازة القراءات للمعلمة سارة، الصفحة 3',
    );
    expect(arabic.mfaResetTitle('سارة')).toBe('إعادة ضبط التحقق بخطوتين لـسارة');
    expect(arabic.review('أحمد', 'الشيخ')).toBe('تقييم أحمد للشيخ');
    expect(arabic.application('أحمد')).toBe('طلب انضمام أحمد');
    expect(arabic.credential('حفص', 'أحمد')).toBe('إجازة حفص · أحمد');
    expect(arabic.ijazah('أحمد', '7K3M-Q9TD')).toBe('إجازة أحمد · 7K3M-Q9TD');
    expect(arabic.chatReport()).toBe('بلاغ محادثة');
  });

  it('names a live person by the display name and a deleted one by the role word', () => {
    expect(personName({ displayName: 'سارة', role: 'teacher', deleted: false })).toBe('سارة');
    expect(personName({ displayName: null, role: 'teacher', deleted: true })).toBe('معلم');
    expect(personName({ displayName: null, role: 'student', deleted: true })).toBe('طالب');
    expect(personName({ displayName: null, role: null, deleted: true })).toBe('مستخدم');
  });

  it('resolves through the readers by type, and no name for a type that names no person', async () => {
    const tx = {} as Transaction;
    const people = new Map<string, TargetPerson>([
      [USER_ID, { displayName: 'سارة', role: 'teacher', deleted: false }],
    ]);
    const readers = {
      person: async (_tx: Transaction, id: string) => people.get(id) ?? null,
      administrator: async (_tx: Transaction, id: string) => (id === 'admin-1' ? 'عمر' : null),
    };
    expect(await resolveTargetName(tx, 'user', USER_ID, readers)).toBe('سارة');
    expect(await resolveTargetName(tx, 'teacher_application', USER_ID, readers)).toBe('سارة');
    expect(await resolveTargetName(tx, 'user', 'unknown', readers)).toBeNull();
    expect(await resolveTargetName(tx, 'admin', 'admin-1', readers)).toBe('عمر');
    expect(await resolveTargetName(tx, 'setting', 'rate_limit_search', readers)).toBeNull();
    expect(await resolveTargetName(tx, 'credential', USER_ID, readers)).toBeNull();
    expect(await resolveTargetName(tx, 'payment', USER_ID, readers)).toBeNull();
  });
});
