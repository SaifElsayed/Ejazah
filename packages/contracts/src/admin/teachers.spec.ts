// T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077) — the inputs of the three
// `teachers.keptData.*` procedures. Written before the schemas, and run red first.
//
// `documentLink { teacherUserId, documentId, reason }` answers one signed link (`documentsLinkOutput`);
// `setEraseDate { teacherUserId, eraseAt: { localDate, localTime, timezone } | null, reason,
// idempotencyKey }` sets, changes or clears the date, a local wall clock with its zone and never an
// instant (R-TIME-6; Q-K1 (a), the review session, 2026-11-14; precedent `outages.record`); `eraseNow { teacherUserId, reason, idempotencyKey }`. Each reason is mandatory,
// each person named `teacherUserId` (a `userId` key is refused in any input, R-GENDER-4).
import { describe, expect, it } from 'vitest';

import {
  KEPT_ERASE_DATE_MIN_HOURS_AHEAD,
  teachersKeptDocumentLinkInput,
  teachersKeptDocumentLinkOutput,
  teachersKeptEraseDateInput,
  teachersKeptEraseNowInput,
} from './teachers.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';
const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d1';
const KEY = 'kept-data-attempt-000001';

describe('teachers.keptData (T077)', () => {
  it('documentLink takes the teacher, the document and a reason, trimmed, and answers a link', () => {
    expect(
      teachersKeptDocumentLinkInput.parse({
        teacherUserId: TEACHER,
        documentId: DOCUMENT,
        reason: '  شكوى احتيال  ',
      }),
    ).toEqual({ teacherUserId: TEACHER, documentId: DOCUMENT, reason: 'شكوى احتيال' });
    const link = { url: 'https://storage.invalid/k', expiresAt: '2026-11-14T10:05:00.000Z' };
    expect(teachersKeptDocumentLinkOutput.parse(link)).toEqual(link);
  });

  it('setEraseDate takes a local wall clock with its zone, or null, with a reason and a key', () => {
    const input = {
      teacherUserId: TEACHER,
      eraseAt: { localDate: '2026-12-01', localTime: '10:00', timezone: 'Africa/Cairo' },
      reason: 'انتهت الحاجة',
      idempotencyKey: KEY,
    };
    expect(teachersKeptEraseDateInput.parse(input)).toEqual(input);
    expect(teachersKeptEraseDateInput.parse({ ...input, eraseAt: null }).eraseAt).toBeNull();
  });

  it('names the bound the line fixes: an erasure date at least 24 hours ahead (FR-509)', () => {
    expect(KEPT_ERASE_DATE_MIN_HOURS_AHEAD).toBe(24);
  });

  it('eraseNow takes the teacher, a reason and a key', () => {
    const input = { teacherUserId: TEACHER, reason: 'طلب الجهات', idempotencyKey: KEY };
    expect(teachersKeptEraseNowInput.parse(input)).toEqual(input);
  });

  it.each([
    [
      'documentLink without a reason',
      teachersKeptDocumentLinkInput,
      { teacherUserId: TEACHER, documentId: DOCUMENT, reason: '  ' },
    ],
    [
      'documentLink naming userId',
      teachersKeptDocumentLinkInput,
      { userId: TEACHER, documentId: DOCUMENT, reason: 'x' },
    ],
    [
      'setEraseDate without the date field',
      teachersKeptEraseDateInput,
      { teacherUserId: TEACHER, reason: 'x', idempotencyKey: KEY },
    ],
    [
      'setEraseDate with a date that is no instant',
      teachersKeptEraseDateInput,
      { teacherUserId: TEACHER, eraseAt: 'tomorrow', reason: 'x', idempotencyKey: KEY },
    ],
    [
      'setEraseDate with an instant (R-TIME-6)',
      teachersKeptEraseDateInput,
      {
        teacherUserId: TEACHER,
        eraseAt: '2026-12-01T08:00:00.000Z',
        reason: 'x',
        idempotencyKey: KEY,
      },
    ],
    [
      'setEraseDate without a zone',
      teachersKeptEraseDateInput,
      {
        teacherUserId: TEACHER,
        eraseAt: { localDate: '2026-12-01', localTime: '10:00' },
        reason: 'x',
        idempotencyKey: KEY,
      },
    ],
    [
      'setEraseDate with a time carrying seconds',
      teachersKeptEraseDateInput,
      {
        teacherUserId: TEACHER,
        eraseAt: { localDate: '2026-12-01', localTime: '10:00:00', timezone: 'UTC' },
        reason: 'x',
        idempotencyKey: KEY,
      },
    ],
    [
      'setEraseDate without a key',
      teachersKeptEraseDateInput,
      { teacherUserId: TEACHER, eraseAt: null, reason: 'x' },
    ],
    [
      'eraseNow without a reason',
      teachersKeptEraseNowInput,
      { teacherUserId: TEACHER, reason: '', idempotencyKey: KEY },
    ],
    ['eraseNow without a key', teachersKeptEraseNowInput, { teacherUserId: TEACHER, reason: 'x' }],
  ] as const)('refuses %s', (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});
