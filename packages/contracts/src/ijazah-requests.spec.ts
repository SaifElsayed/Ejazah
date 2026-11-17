// T006 of specs/005-certification: the `teacher.ijazahRequests` contracts (FR-603, FR-608, FR-627;
// contracts/app-surface.md, `teacher.ijazahRequests.*` and «Enrollment reads gain»).
//
// - The input names the enrollment, the completion date and the language (Arabic unless said,
//   FR-LOC-4); `send` adds the kernel's idempotency key.
// - The preview answers the filled certificate: the chain's generations, the teacher's printed name,
//   the riwaya and the tariq, the student's certificate name or null, and the two dates.
// - The request's state as a party reads it: its status, the reason once rejected, the ijazah once
//   approved; never the signature copy's key (R-SEC-3) or the frozen chain.
// - The refusals FR-603 names, one closed list.
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  enrollmentIjazahRequest,
  ijazahRequestRefusal,
  ijazahRequestsGetInput,
  ijazahRequestsGetOutput,
  ijazahRequestsPreviewInput,
  ijazahRequestsPreviewOutput,
  ijazahRequestsSendInput,
  ijazahRequestsSendOutput,
} from './ijazah-requests.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e1a1';
const REQUEST = '0199d0a0-0000-7000-8000-00000000a1a1';
const IJAZAH = '0199d0a0-0000-7000-8000-00000000b1b1';
const KEY = `probe-request-${randomUUID()}`;

describe('teacher.ijazahRequests inputs (T006)', () => {
  it('defaults the language to Arabic and keeps an English one', () => {
    expect(
      ijazahRequestsPreviewInput.parse({ enrollmentId: ENROLLMENT, completionDate: '2026-11-10' }),
    ).toEqual({ enrollmentId: ENROLLMENT, completionDate: '2026-11-10', language: 'ar' });
    expect(
      ijazahRequestsPreviewInput.parse({
        enrollmentId: ENROLLMENT,
        completionDate: '2026-11-10',
        language: 'en',
      }).language,
    ).toBe('en');
  });

  it('refuses a date that is not a calendar date, a third language and an id that is not one', () => {
    for (const input of [
      { enrollmentId: ENROLLMENT, completionDate: '2026-11-10T00:00:00Z' },
      { enrollmentId: ENROLLMENT, completionDate: '2026-13-01' },
      { enrollmentId: ENROLLMENT, completionDate: '2026-11-10', language: 'fr' },
      { enrollmentId: 'not an id', completionDate: '2026-11-10' },
    ]) {
      expect(ijazahRequestsPreviewInput.safeParse(input).success).toBe(false);
    }
  });

  it('keys send and refuses it without a key', () => {
    const input = { enrollmentId: ENROLLMENT, completionDate: '2026-11-10' };
    expect(ijazahRequestsSendInput.safeParse(input).success).toBe(false);
    expect(ijazahRequestsSendInput.parse({ ...input, idempotencyKey: KEY })).toEqual({
      ...input,
      language: 'ar',
      idempotencyKey: KEY,
    });
  });

  it('takes the enrollment alone for get', () => {
    expect(ijazahRequestsGetInput.parse({ enrollmentId: ENROLLMENT, status: 'x' })).toEqual({
      enrollmentId: ENROLLMENT,
    });
  });
});

describe('teacher.ijazahRequests outputs (T006)', () => {
  it('answers the filled certificate, the student name null while none is held', () => {
    const preview = {
      chain: [['الأول'], ['الثاني', 'الثالث'], ['المعلم']],
      teacherName: 'المعلم',
      riwaya: 'حفص',
      tariq: null,
      studentName: null,
      dates: { completionDate: '2026-11-10', issueDate: '2026-11-17' },
    };
    expect(ijazahRequestsPreviewOutput.parse(preview)).toEqual(preview);
    expect(ijazahRequestsPreviewOutput.safeParse({ ...preview, chain: [[]] }).success).toBe(false);
  });

  it('answers the request and its status after a send', () => {
    expect(
      ijazahRequestsSendOutput.parse({ requestId: REQUEST, status: 'awaiting_student_name' }),
    ).toEqual({ requestId: REQUEST, status: 'awaiting_student_name' });
    expect(ijazahRequestsSendOutput.safeParse({ requestId: REQUEST, status: 'sent' }).success).toBe(
      false,
    );
  });

  it('strips the copy key and the frozen chain from what a party reads', () => {
    const read = {
      requestId: REQUEST,
      status: 'approved',
      ijazahId: IJAZAH,
      signatureStorageKey: `ijazah-requests/${REQUEST}/signature.png`,
      chainSnapshot: [['الأول']],
    };
    expect(ijazahRequestsGetOutput.parse({ request: read })).toEqual({
      request: { requestId: REQUEST, status: 'approved', ijazahId: IJAZAH },
    });
    expect(ijazahRequestsGetOutput.parse({ request: null })).toEqual({ request: null });
    expect(enrollmentIjazahRequest.parse({ status: 'rejected', reason: 'سبب', extra: 1 })).toEqual({
      status: 'rejected',
      reason: 'سبب',
    });
  });

  // 005:T010 (B46, Q-E2 (a); FR-609, R-HONEST-6): an approved request whose ijazah was revoked
  // carries the flag only, so no party reads it as a valid certificate; never the revocation's reason.
  it('keeps `revoked: true` on a revoked ijazah, refuses any other value, and carries no reason of it', () => {
    const read = { status: 'approved', ijazahId: IJAZAH, revoked: true };
    expect(enrollmentIjazahRequest.parse(read)).toEqual(read);
    expect(ijazahRequestsGetOutput.parse({ request: { requestId: REQUEST, ...read } })).toEqual({
      request: { requestId: REQUEST, ...read },
    });
    expect(enrollmentIjazahRequest.safeParse({ ...read, revoked: false }).success).toBe(false);
    expect(
      enrollmentIjazahRequest.parse({ ...read, revokedReason: 'خطأ في السند' }),
    ).not.toHaveProperty('revokedReason');
  });

  it('lists the seven refusals of FR-603 and nothing else', () => {
    expect(ijazahRequestRefusal.options).toEqual([
      'not_active',
      'not_ijazah_track',
      'no_credential',
      'no_signature',
      'student_barred',
      'request_open',
      'already_issued',
    ]);
  });
});
