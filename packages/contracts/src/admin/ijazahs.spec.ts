// T007 of specs/005-certification — the `ijazahRequests` schemas of contracts/admin-surface.md
// (FR-604, FR-605, FR-628; R-402). Written before the schemas, and run red first.
//
// `list` takes an optional status and a request id as its cursor; `get` answers the frozen
// certificate, the teacher's current standing and its reason (FR-628) and a signed link to the frozen
// signature, never the copy's key; `approve` is keyed and answers the ijazah and its 16-symbol
// Crockford number (FR-605); `reject` is keyed and needs a reason (FR-604).
import { describe, expect, it } from 'vitest';

import {
  adminIjazahRequestsApproveInput,
  adminIjazahRequestsApproveOutput,
  adminIjazahRequestsGetInput,
  adminIjazahRequestsGetOutput,
  adminIjazahRequestsListInput,
  adminIjazahRequestsListOutput,
  adminIjazahRequestsRejectInput,
  certificateNumber,
  ijazahDecisionRefusal,
  teacherStanding,
} from './ijazahs.js';

const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const KEY = 'decision-key-for-the-spec-0001';

const ROW = {
  requestId: REQUEST,
  enrollmentId: ENROLLMENT,
  teacher: { userId: TEACHER, displayName: 'عمر' },
  student: { userId: STUDENT, displayName: null },
  subject: { id: SUBJECT, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' },
  status: 'pending',
  sentAt: '2026-11-17T09:00:00.000Z',
  teacherStanding: { status: 'active' },
};

const DETAIL = {
  ...ROW,
  completionDate: '2026-11-10',
  language: 'ar',
  chain: [['رسول الله ﷺ'], ['جبريل', 'أبي بن كعب'], ['عمر بن فاروق']],
  teacherNamePrinted: 'عمر بن فاروق',
  studentName: 'مريم بنت أحمد',
  riwaya: 'حفص عن عاصم',
  tariq: null,
  signatureLink: 'https://storage.example.test/signed',
  teacherStanding: { status: 'suspended', reason: 'شكوى متكررة' },
};

describe('ijazahRequests.list (admin-surface.md)', () => {
  it('takes an optional status and an optional request id as its cursor', () => {
    expect(adminIjazahRequestsListInput.parse({})).toEqual({});
    expect(adminIjazahRequestsListInput.parse({ status: 'pending', cursor: REQUEST })).toEqual({
      status: 'pending',
      cursor: REQUEST,
    });
  });

  it.each([
    ['an unknown status', { status: 'issued' }],
    ['a cursor that is not an id', { cursor: 'page-2' }],
  ])('refuses %s', (_case, input) => {
    expect(adminIjazahRequestsListInput.safeParse(input).success).toBe(false);
  });

  it('answers each row with the standing status only and the next cursor', () => {
    const page = adminIjazahRequestsListOutput.parse({ items: [ROW], nextCursor: REQUEST });
    expect(page.items[0]?.teacherStanding).toEqual({ status: 'active' });
    expect(adminIjazahRequestsListOutput.parse({ items: [] })).toEqual({ items: [] });
  });

  it("strips a standing reason from a list row (FR-628's reason is get's)", () => {
    const page = adminIjazahRequestsListOutput.parse({
      items: [{ ...ROW, teacherStanding: { status: 'banned', reason: 'x' } }],
    });
    expect(page.items[0]?.teacherStanding).toEqual({ status: 'banned' });
  });
});

describe('ijazahRequests.get (FR-604, FR-628)', () => {
  it('takes the request id only', () => {
    expect(adminIjazahRequestsGetInput.parse({ requestId: REQUEST })).toEqual({
      requestId: REQUEST,
    });
    expect(adminIjazahRequestsGetInput.safeParse({ enrollmentId: ENROLLMENT }).success).toBe(false);
  });

  it('answers the frozen certificate, the standing with its reason and the signature link', () => {
    const detail = adminIjazahRequestsGetOutput.parse(DETAIL);
    expect(detail.teacherStanding).toEqual({ status: 'suspended', reason: 'شكوى متكررة' });
    expect(detail.chain).toHaveLength(3);
    expect(detail.signatureLink).toBe('https://storage.example.test/signed');
  });

  it("never answers the copy's storage key (R-SEC-3)", () => {
    const detail = adminIjazahRequestsGetOutput.parse({
      ...DETAIL,
      signatureStorageKey: `ijazah-requests/${REQUEST}/signature.png`,
    });
    expect(detail).not.toHaveProperty('signatureStorageKey');
  });

  it('answers a decided request with its reason or its ijazah', () => {
    const rejected = adminIjazahRequestsGetOutput.parse({
      ...DETAIL,
      status: 'rejected',
      reason: 'السند لا يطابق',
      decidedAt: '2026-11-17T10:00:00.000Z',
      signatureLink: null,
    });
    expect(rejected.reason).toBe('السند لا يطابق');
    const approved = adminIjazahRequestsGetOutput.parse({
      ...DETAIL,
      status: 'approved',
      ijazahId: IJAZAH,
      decidedAt: '2026-11-17T10:00:00.000Z',
    });
    expect(approved.ijazahId).toBe(IJAZAH);
  });

  it.each([
    ['an empty chain', { chain: [] }],
    ['an empty generation', { chain: [[]] }],
    ['an unknown standing', { teacherStanding: { status: 'paused' } }],
  ])('refuses %s', (_case, change) => {
    expect(adminIjazahRequestsGetOutput.safeParse({ ...DETAIL, ...change }).success).toBe(false);
  });
});

describe('ijazahRequests.approve (FR-605)', () => {
  it('is keyed', () => {
    expect(
      adminIjazahRequestsApproveInput.safeParse({ requestId: REQUEST, idempotencyKey: KEY })
        .success,
    ).toBe(true);
    expect(adminIjazahRequestsApproveInput.safeParse({ requestId: REQUEST }).success).toBe(false);
  });

  it('answers the ijazah and its 16-symbol Crockford number', () => {
    expect(
      adminIjazahRequestsApproveOutput.parse({
        ijazahId: IJAZAH,
        certificateNumber: '7K3MQ9TD2XWB8HRN',
      }),
    ).toEqual({ ijazahId: IJAZAH, certificateNumber: '7K3MQ9TD2XWB8HRN' });
  });

  it.each([
    ['a lower-case symbol', '7k3mQ9TD2XWB8HRN'],
    ['an I, L, O or U', '7K3MQ9TD2XWB8HRI'],
    ['15 symbols', '7K3MQ9TD2XWB8HR'],
    ['the grouped form', '7K3M-Q9TD-2XWB-8HRN'],
  ])('refuses a number with %s', (_case, number) => {
    expect(certificateNumber.safeParse(number).success).toBe(false);
  });
});

describe('ijazahRequests.reject (FR-604)', () => {
  it('is keyed and needs a reason, trimmed', () => {
    expect(
      adminIjazahRequestsRejectInput.parse({
        requestId: REQUEST,
        reason: '  السند لا يطابق  ',
        idempotencyKey: KEY,
      }),
    ).toEqual({ requestId: REQUEST, reason: 'السند لا يطابق', idempotencyKey: KEY });
  });

  it.each([
    ['no reason', { requestId: REQUEST, idempotencyKey: KEY }],
    ['a blank reason', { requestId: REQUEST, reason: '   ', idempotencyKey: KEY }],
    ['no key', { requestId: REQUEST, reason: 'سبب' }],
  ])('refuses %s', (_case, input) => {
    expect(adminIjazahRequestsRejectInput.safeParse(input).success).toBe(false);
  });
});

describe("the decisions' refusals and the standing", () => {
  it('names the two CONFLICT codes of a decision', () => {
    expect(ijazahDecisionRefusal.options).toEqual(['not_pending', 'student_barred']);
  });

  it('keeps the reason optional', () => {
    expect(teacherStanding.parse({ status: 'deleted' })).toEqual({ status: 'deleted' });
  });
});
