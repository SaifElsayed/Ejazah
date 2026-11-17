// T021 — the audit label is never a name, bounded in length, and the read-time name carries the
// fused forms (FR-180, FR-181, ADR 0021 D2, research R-108).
import { AUDIT_LABEL_MAX_LENGTH } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../platform/db/prisma.repository.js';
import type { TargetPerson } from '../../identity/index.js';
import {
  auditTargetKinds,
  isAuditTargetType,
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
      // 005:T007: an ijazah is labelled by its certificate number only (below).
      if (type === 'ijazah') continue;
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

// T002 of specs/004-sessions (contracts/admin-surface.md, "The audit target"; the owner's decision
// of 2026-11-06 on the fifth analysis, G3): every action of Phase 3 that targets one row, with the
// type admin-surface.md gives it. A type the writer did not know would make `targetLabel` throw
// and roll the action back (FR-180), so each must label a row's uuid. The list reads (`*.listed`)
// keep the `admin` target of Phase 1's and Phase 2's list reads.
const PHASE_3_ACTIONS: readonly (readonly [string, string])[] = [
  ['sessions.monitor.listed', 'admin'],
  ['sessions.monitor.viewed', 'enrollment'],
  ['sessions.review.listed', 'admin'],
  ['sessions.review.viewed', 'session'],
  ['provider_outages.listed', 'admin'],
  ['disputes.listed', 'admin'],
  ['dispute.viewed', 'dispute'],
  ['cases.listed', 'admin'],
  ['case.viewed', 'dispute'],
  ['users.listed', 'admin'],
  ['user.viewed', 'user'],
  ['chat.read', 'enrollment'],
  ['dispute.held_files_listed', 'dispute'],
  ['held_file.view', 'dispute'],
  ['session.cancelled', 'session'],
  ['enrollment.restored', 'enrollment'],
  ['session.review_resolved', 'session'],
  ['session.outcome_corrected', 'session'],
  ['provider_outage.recorded', 'provider_outage'],
  ['dispute.resolved', 'dispute'],
  ['dispute.revised', 'dispute'],
  ['case.resolved', 'dispute'],
  ['case.dismissed', 'dispute'],
  ['case.opened_manually', 'dispute'],
  ['complaint.decided', 'dispute'],
  ['student.suspend', 'user'],
  ['student.ban', 'user'],
  ['student.reinstate', 'user'],
];

describe('the Phase 3 audit targets (T002 of specs/004-sessions, G3)', () => {
  it('labels each of the four new types by its kind word', () => {
    expect(targetLabel('enrollment', USER_ID)).toBe(`اشتراك · ${USER_ID}`);
    expect(targetLabel('dispute', USER_ID)).toBe(`نزاع أو قضية · ${USER_ID}`);
    expect(targetLabel('session', USER_ID)).toBe(`جلسة · ${USER_ID}`);
    expect(targetLabel('provider_outage', USER_ID)).toBe(`انقطاع الفيديو · ${USER_ID}`);
  });

  it.each(PHASE_3_ACTIONS)(
    '%s: its target type %s labels a uuid, so the action never throws',
    (_action, type) => {
      expect(isAuditTargetType(type)).toBe(true);
      expect(targetLabel(type, USER_ID)).toBe(
        `${auditTargetKinds[type as keyof typeof auditTargetKinds]}${LABEL_SEPARATOR}${USER_ID}`,
      );
    },
  );

  it('names no target of the four new types: the type alone, as a payment order', async () => {
    const tx = {} as Transaction;
    const readers = {
      person: () => Promise.reject(new Error('no person is read')),
      administrator: () => Promise.reject(new Error('no administrator is read')),
    };
    for (const type of ['enrollment', 'dispute', 'session', 'provider_outage'] as const) {
      expect(await resolveTargetName(tx, type, USER_ID, readers)).toBeNull();
    }
  });
});

// 005:T007 of B46 (Q-C3 (a), the owner's word and the review's ruling of 2026-11-17): the
// administrators' review of an ijazah request. A request is labelled by its id; an ijazah by its
// certificate number in the printed 4-4-4-4 form of docs/ERD.md:806, written once at the action.
// `ijazah_requests.listed` keeps the `admin` target of the other list reads.
const NUMBER = '7K3MQ9TD2XWB8HRN';

describe('the ijazah review audit targets (005:T007)', () => {
  it('labels a request by its id and an ijazah by its number, grouped 4-4-4-4', () => {
    expect(targetLabel('ijazah_request', USER_ID)).toBe(`طلب إجازة · ${USER_ID}`);
    expect(targetLabel('ijazah', NUMBER)).toBe('إجازة · 7K3M-Q9TD-2XWB-8HRN');
  });

  it.each([
    ['a uuid', USER_ID],
    ['the grouped form', '7K3M-Q9TD-2XWB-8HRN'],
    ['a lower-case number', NUMBER.toLowerCase()],
    ['15 symbols', NUMBER.slice(1)],
  ])('refuses an ijazah identified by %s', (_case, id) => {
    expect(() => targetLabel('ijazah', id)).toThrow(TargetLabelError);
  });

  it.each([
    ['ijazah_requests.listed', 'admin', USER_ID],
    ['ijazah_request.viewed', 'ijazah_request', USER_ID],
    ['ijazah.issued', 'ijazah', NUMBER],
    ['ijazah_request.rejected', 'ijazah_request', USER_ID],
  ])(
    '%s: its target type %s labels its identifier, so the action never throws',
    (_action, type, id) => {
      expect(isAuditTargetType(type)).toBe(true);
      expect(() => targetLabel(type, id)).not.toThrow();
    },
  );

  it('names no person for either type', async () => {
    const tx = {} as Transaction;
    const readers = {
      person: () => Promise.reject(new Error('no person is read')),
      administrator: () => Promise.reject(new Error('no administrator is read')),
    };
    expect(await resolveTargetName(tx, 'ijazah_request' as never, USER_ID, readers)).toBeNull();
    expect(await resolveTargetName(tx, 'ijazah' as never, NUMBER, readers)).toBeNull();
  });
});
