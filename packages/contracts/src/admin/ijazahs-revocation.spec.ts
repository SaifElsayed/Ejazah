// T010 of specs/005-certification — the `ijazahs` schemas of contracts/admin-surface.md (FR-609,
// FR-610; R-412; the note under T010). Written before the schemas, and run red first.
//
// `list` takes an optional status (preparing, rendered, signed off, revoked) and an ijazah id as its
// cursor; each row says whether it is rendered and whether it is revoked, and never carries the PDF's
// key or the token's hash (R-SEC-3, R-DB-7); `get` adds the frozen certificate, the revocation's
// reason and a signed link to the PDF, never its key; `revoke`, `bar` and `liftBar` are keyed and need
// a reason (FR-609, FR-610).
import { describe, expect, it } from 'vitest';

import {
  adminIjazahBarInput,
  adminIjazahStatus,
  adminIjazahsGetInput,
  adminIjazahsGetOutput,
  adminIjazahsListInput,
  adminIjazahsListOutput,
  adminIjazahsRevokeInput,
  ijazahsRefusal,
} from './ijazahs.js';

const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000c1';
const KEY = 'decision-key-for-the-spec-0001';

const ROW = {
  ijazahId: IJAZAH,
  certificateNumber: '7K3MQ9TD2XWB8HRN',
  enrollmentId: ENROLLMENT,
  requestId: REQUEST,
  teacher: { userId: TEACHER, displayName: 'عمر' },
  student: { userId: STUDENT, displayName: null },
  subject: { id: SUBJECT, nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' },
  language: 'ar',
  grantedAt: '2026-11-17T09:00:00.000Z',
  status: 'revoked',
  rendered: true,
  revoked: true,
  renderGeneration: 1,
  signedOffAt: '2026-11-17T10:00:00.000Z',
  revokedAt: '2026-11-17T11:00:00.000Z',
};

const DETAIL = {
  ...ROW,
  completionDate: '2026-11-10',
  chain: [['رسول الله ﷺ'], ['عمر بن فاروق']],
  studentNamePrinted: 'مريم بنت أحمد',
  teacherNamePrinted: 'عمر بن فاروق',
  riwaya: 'حفص عن عاصم',
  tariq: null,
  revokedReason: 'خطأ في السند',
  pdfLink: 'https://storage.example.test/signed',
};

describe('ijazahs.list (admin-surface.md)', () => {
  it('takes an optional status and an optional ijazah id as its cursor', () => {
    expect(adminIjazahsListInput.parse({})).toEqual({});
    expect(adminIjazahsListInput.parse({ status: 'revoked', cursor: IJAZAH })).toEqual({
      status: 'revoked',
      cursor: IJAZAH,
    });
  });

  it('knows four statuses, none of them «valid»', () => {
    expect(adminIjazahStatus.options).toEqual(['preparing', 'rendered', 'signed_off', 'revoked']);
    expect(adminIjazahsListInput.safeParse({ status: 'valid' }).success).toBe(false);
    expect(adminIjazahsListInput.safeParse({ cursor: 'not-an-id' }).success).toBe(false);
  });

  it('answers each row with its rendering and its revocation, and no key or token hash', () => {
    const parsed = adminIjazahsListOutput.parse({
      items: [
        { ...ROW, certificateStorageKey: 'certificates/x/0.pdf', verificationTokenHash: 'h' },
      ],
      nextCursor: IJAZAH,
    });
    expect(parsed.items[0]).toEqual(ROW);
  });

  it('refuses a row that does not say whether it is revoked or rendered', () => {
    const { revoked: _revoked, ...withoutRevoked } = ROW;
    const { rendered: _rendered, ...withoutRendered } = ROW;
    expect(adminIjazahsListOutput.safeParse({ items: [withoutRevoked] }).success).toBe(false);
    expect(adminIjazahsListOutput.safeParse({ items: [withoutRendered] }).success).toBe(false);
  });
});

describe('ijazahs.get (admin-surface.md, R-412)', () => {
  it('takes the ijazah id', () => {
    expect(adminIjazahsGetInput.parse({ ijazahId: IJAZAH })).toEqual({ ijazahId: IJAZAH });
    expect(adminIjazahsGetInput.safeParse({ ijazahId: 'x' }).success).toBe(false);
  });

  it('answers the frozen certificate, the reason and a signed link, never the key', () => {
    const parsed = adminIjazahsGetOutput.parse({
      ...DETAIL,
      certificateStorageKey: 'certificates/x/1.pdf',
    });
    expect(parsed).toEqual(DETAIL);
  });

  it('answers no link before the rendering', () => {
    const parsed = adminIjazahsGetOutput.parse({ ...DETAIL, rendered: false, pdfLink: null });
    expect(parsed.pdfLink).toBeNull();
  });

  it('refuses a detail without its link field or its reason field', () => {
    const { pdfLink: _link, ...withoutLink } = DETAIL;
    const { revokedReason: _reason, ...withoutReason } = DETAIL;
    expect(adminIjazahsGetOutput.safeParse(withoutLink).success).toBe(false);
    expect(adminIjazahsGetOutput.safeParse(withoutReason).success).toBe(false);
  });
});

describe('ijazahs.revoke, .bar and .liftBar (FR-609, FR-610)', () => {
  it('revoke is keyed and needs a reason', () => {
    expect(
      adminIjazahsRevokeInput.parse({ ijazahId: IJAZAH, reason: ' خطأ ', idempotencyKey: KEY }),
    ).toEqual({ ijazahId: IJAZAH, reason: 'خطأ', idempotencyKey: KEY });
    expect(
      adminIjazahsRevokeInput.safeParse({ ijazahId: IJAZAH, idempotencyKey: KEY }).success,
    ).toBe(false);
    expect(
      adminIjazahsRevokeInput.safeParse({ ijazahId: IJAZAH, reason: '   ', idempotencyKey: KEY })
        .success,
    ).toBe(false);
    expect(adminIjazahsRevokeInput.safeParse({ ijazahId: IJAZAH, reason: 'خطأ' }).success).toBe(
      false,
    );
  });

  it('bar and liftBar take the user, a reason and a key', () => {
    expect(
      adminIjazahBarInput.parse({ targetUserId: STUDENT, reason: 'تزوير', idempotencyKey: KEY }),
    ).toEqual({ targetUserId: STUDENT, reason: 'تزوير', idempotencyKey: KEY });
    expect(
      adminIjazahBarInput.safeParse({ targetUserId: STUDENT, idempotencyKey: KEY }).success,
    ).toBe(false);
    expect(
      adminIjazahBarInput.safeParse({ targetUserId: 'x', reason: 'تزوير', idempotencyKey: KEY })
        .success,
    ).toBe(false);
  });

  it('names its three refusals', () => {
    expect(ijazahsRefusal.options).toEqual(['already_revoked', 'already_barred', 'not_barred']);
  });
});
