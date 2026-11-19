// T013 of specs/005-certification — the administrator's `genderFlags` schemas of
// contracts/admin-surface.md (FR-614, FR-615; research R-409; the note under T013, Q-G1 (a)).
// Written before the schemas, and run red first.
//
// `list` takes an optional status (the queue's `open` unless said) and a flag id as its cursor;
// `get` adds the raiser's reason, the resolution and the preview of what a correction would end;
// `raise` names the person as `targetUserId` (never `userId`), an optional report, a reason and a
// key; `dismiss` a flag, a reason and a key. No declared gender crosses either way.
import { describe, expect, it } from 'vitest';

import { isIdempotentProcedure } from '../idempotent-procedures.js';
import {
  adminGenderFlagsCorrectInput,
  adminGenderFlagsCorrectOutput,
  adminGenderFlagsDismissInput,
  adminGenderFlagsFraudBanInput,
  adminGenderFlagsGetInput,
  adminGenderFlagsGetOutput,
  adminGenderFlagsListInput,
  adminGenderFlagsListOutput,
  adminGenderFlagsRaiseInput,
  adminGenderFlagsRaiseOutput,
  genderFlagDecisionRefusal,
  genderFlagOutcome,
  genderFlagStatus,
} from './gender-flags.js';

const FLAG = '0199d0a0-0000-7000-8000-0000000000f1';
const FLAGGED = '0199d0a0-0000-7000-8000-0000000000a2';
const RAISER = '0199d0a0-0000-7000-8000-0000000000a1';
const REPORT = '0199d0a0-0000-7000-8000-0000000000c1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000b9';
const KEY = 'flag-decision-key-for-the-spec-0001';
const REASON = 'المستندات تثبت خطأ في التسجيل';

const ITEM = {
  flagId: FLAG,
  flaggedUserId: FLAGGED,
  raisedByUserId: RAISER,
  reportId: null,
  status: 'open',
  createdAt: '2026-11-18T09:00:00.000Z',
};

describe('the statuses', () => {
  it('a flag is open, corrected, fraud_ban or dismissed; it closes to one of the last three', () => {
    expect(genderFlagStatus.options).toEqual(['open', 'corrected', 'fraud_ban', 'dismissed']);
    expect(genderFlagOutcome.options).toEqual(['corrected', 'fraud_ban', 'dismissed']);
    expect(genderFlagDecisionRefusal.options).toEqual([
      'already_resolved',
      'open_exists',
      'report_target_mismatch',
      // 005:T015 (Q-G5 (b)): an applicant's fraud ban without the note the applicant sees.
      'applicant_note_required',
    ]);
  });
});

describe('genderFlags.list', () => {
  it('takes an optional status and cursor, the queue being the open flags', () => {
    expect(adminGenderFlagsListInput.parse({})).toEqual({ status: 'open' });
    expect(adminGenderFlagsListInput.parse({ status: 'dismissed', cursor: FLAG })).toEqual({
      status: 'dismissed',
      cursor: FLAG,
    });
    expect(adminGenderFlagsListInput.safeParse({ status: 'closed' }).success).toBe(false);
  });

  it('answers each flag by ids, with no reason and no gender', () => {
    const page = { items: [{ ...ITEM, reason: REASON, gender: 'male' }], nextCursor: FLAG };
    expect(adminGenderFlagsListOutput.parse(page)).toEqual({ items: [ITEM], nextCursor: FLAG });
    expect(
      adminGenderFlagsListOutput.parse({
        items: [{ ...ITEM, raisedByUserId: null, reportId: REPORT }],
      }),
    ).toEqual({ items: [{ ...ITEM, raisedByUserId: null, reportId: REPORT }] });
  });
});

// 005:T023 (B49, Q-G1 (b); admin-surface.md:22 as amended): the preview is a count and one line per
// enrollment a correction would end: the enrollment, its subject, its sessions and the other party
// (an id, and a name null once that account is deleted). The ids travel on the lines only.
const SUBJECT = {
  id: '0199d0a0-0000-7000-8000-0000000000d1',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const COUNTERPART = '0199d0a0-0000-7000-8000-0000000000a3';
const LINE = {
  enrollmentId: ENROLLMENT,
  subject: SUBJECT,
  sessions: 8,
  counterpart: { userId: COUNTERPART, displayName: 'فاطمة' },
};

/** A flag's detail with `correctionWouldEnd` as given. */
const detailWith = (correctionWouldEnd: unknown) => ({
  ...ITEM,
  reason: REASON,
  resolution: null,
  correctionWouldEnd,
});

describe('genderFlags.get', () => {
  it('adds the reason, the resolution and the preview of a correction, and no gender', () => {
    const open = detailWith({ count: 1, lines: [LINE] });
    expect(adminGenderFlagsGetInput.parse({ flagId: FLAG })).toEqual({ flagId: FLAG });
    expect(adminGenderFlagsGetOutput.parse({ ...open, gender: 'female' })).toEqual(open);
    const dismissed = {
      ...open,
      status: 'dismissed',
      resolution: {
        outcome: 'dismissed',
        note: REASON,
        resolvedAt: '2026-11-18T10:00:00.000Z',
        resolvedByAdminId: ADMIN,
      },
      correctionWouldEnd: { count: 0, lines: [] },
    };
    expect(adminGenderFlagsGetOutput.parse(dismissed)).toEqual(dismissed);
    expect(adminGenderFlagsGetOutput.safeParse(detailWith({ count: -1, lines: [] })).success).toBe(
      false,
    );
  });

  it('draws each line: the enrollment, its subject, its sessions and the other party', () => {
    const gone = { ...LINE, counterpart: { userId: COUNTERPART, displayName: null } };
    const preview = { count: 2, lines: [LINE, gone] };
    const parsed = adminGenderFlagsGetOutput.parse(
      detailWith({ ...preview, enrollmentIds: [ENROLLMENT] }),
    );
    expect(parsed.correctionWouldEnd).toEqual(preview);
    expect(parsed.correctionWouldEnd.lines[1]?.counterpart.displayName).toBeNull();
  });

  it('refuses a line without its enrollment, subject, sessions or other party', () => {
    expect(
      adminGenderFlagsGetOutput.safeParse(detailWith({ count: 1, lines: [LINE] })).success,
    ).toBe(true);
    for (const line of [
      { ...LINE, enrollmentId: 'enrollment' },
      { ...LINE, subject: { id: SUBJECT.id, nameAr: 'التجويد' } },
      { ...LINE, sessions: 0 },
      { ...LINE, sessions: 1.5 },
      { ...LINE, counterpart: { displayName: 'فاطمة' } },
      { ...LINE, counterpart: { userId: COUNTERPART } },
    ]) {
      expect(
        adminGenderFlagsGetOutput.safeParse(detailWith({ count: 1, lines: [line] })).success,
      ).toBe(false);
    }
  });

  it('refuses a count that is not the number of lines', () => {
    expect(
      adminGenderFlagsGetOutput.safeParse(detailWith({ count: 2, lines: [LINE, LINE] })).success,
    ).toBe(true);
    for (const preview of [
      { count: 2, lines: [LINE] },
      { count: 0, lines: [LINE] },
      { count: 1, lines: [] },
    ]) {
      expect(adminGenderFlagsGetOutput.safeParse(detailWith(preview)).success).toBe(false);
    }
  });
});

describe('genderFlags.raise', () => {
  it('names the person as targetUserId, with an optional report, a reason and a key', () => {
    const alone = { targetUserId: FLAGGED, reason: REASON, idempotencyKey: KEY };
    expect(adminGenderFlagsRaiseInput.parse(alone)).toEqual(alone);
    expect(adminGenderFlagsRaiseInput.parse({ ...alone, reportId: REPORT })).toEqual({
      ...alone,
      reportId: REPORT,
    });
    expect(adminGenderFlagsRaiseInput.parse({ ...alone, gender: 'male' })).toEqual(alone);
    expect(adminGenderFlagsRaiseOutput.parse({ flagId: FLAG })).toEqual({ flagId: FLAG });
    expect(isIdempotentProcedure('genderFlags.raise')).toBe(true);
  });

  it('refuses no person, no reason, no key and a report that is not an id', () => {
    for (const input of [
      { reason: REASON, idempotencyKey: KEY },
      { targetUserId: FLAGGED, reason: ' ', idempotencyKey: KEY },
      { targetUserId: FLAGGED, reason: REASON },
      { targetUserId: FLAGGED, reason: REASON, idempotencyKey: KEY, reportId: 'report' },
    ]) {
      expect(adminGenderFlagsRaiseInput.safeParse(input).success).toBe(false);
    }
  });
});

describe('genderFlags.dismiss', () => {
  it('takes the flag, a reason and a key, and is keyed by the kernel', () => {
    const input = { flagId: FLAG, reason: REASON, idempotencyKey: KEY };
    expect(adminGenderFlagsDismissInput.parse(input)).toEqual(input);
    expect(
      adminGenderFlagsDismissInput.safeParse({ flagId: FLAG, idempotencyKey: KEY }).success,
    ).toBe(false);
    expect(isIdempotentProcedure('genderFlags.dismiss')).toBe(true);
  });
});

// 005:T014 (FR-616; research R-409; admin-surface.md, `genderFlags.correct`): the correction takes the
// flag, a reason and a key, never a gender (the other declared gender is the server's, from the
// flag), and answers how many enrollments it ended.
describe('genderFlags.correct', () => {
  it('takes the flag, a reason and a key, strips a gender, and is keyed by the kernel', () => {
    const input = { flagId: FLAG, reason: REASON, idempotencyKey: KEY };
    expect(adminGenderFlagsCorrectInput.parse({ ...input, gender: 'female', to: 'male' })).toEqual(
      input,
    );
    expect(
      adminGenderFlagsCorrectInput.safeParse({ flagId: FLAG, idempotencyKey: KEY }).success,
    ).toBe(false);
    expect(isIdempotentProcedure('genderFlags.correct')).toBe(true);
  });

  it('answers the number of enrollments it ended, a whole number, and nothing else', () => {
    expect(adminGenderFlagsCorrectOutput.parse({ endedEnrollments: 2, from: 'male' })).toEqual({
      endedEnrollments: 2,
    });
    expect(adminGenderFlagsCorrectOutput.safeParse({ endedEnrollments: -1 }).success).toBe(false);
  });
});

// 005:T015 (FR-617; SRS FR-GENDER-6; research R-409; the note under T015, Q-G5 (b)): the fraud ban
// takes the flag, a reason, an optional note the applicant sees (`applications.ban`'s `note`) and
// a key, never a gender; it answers nothing.
describe('genderFlags.fraudBan', () => {
  it('takes the flag, a reason, an optional applicant note and a key, strips a gender, keyed', () => {
    const input = { flagId: FLAG, reason: REASON, idempotencyKey: KEY };
    expect(adminGenderFlagsFraudBanInput.parse({ ...input, gender: 'male' })).toEqual(input);
    expect(
      adminGenderFlagsFraudBanInput.parse({ ...input, applicantNote: ' تم رفض الطلب ' }),
    ).toEqual({ ...input, applicantNote: 'تم رفض الطلب' });
    expect(adminGenderFlagsFraudBanInput.safeParse({ ...input, applicantNote: ' ' }).success).toBe(
      false,
    );
    expect(
      adminGenderFlagsFraudBanInput.safeParse({ flagId: FLAG, idempotencyKey: KEY }).success,
    ).toBe(false);
    expect(isIdempotentProcedure('genderFlags.fraudBan')).toBe(true);
  });
});
