// T049 — the `enrollments` schemas of specs/003-booking/contracts/app-surface.md "`enrollments` and
// the teacher's lists" (FR-390, FR-392, FR-393, FR-395). Written before the schemas, and run red first.
//
// The student names the tab, the page or the enrollment, never who asks (R-GENDER-4). Every session
// carries its local date, local start and zone beside its instants and its status, so the phone
// shows it in the teacher's zone and the viewer's (FR-393, R-TIME-6). Upcoming, completed and
// remaining are counts the server derives (FR-392, R-DB-4). The item carries what the screens draw
// and nothing else: no price, no order, no cancellation reason (FR-395).
import { describe, expect, it } from 'vitest';

import {
  enrollmentListTab,
  enrollmentsGetInput,
  enrollmentsGetOutput,
  enrollmentsListInput,
  enrollmentsListOutput,
  enrollmentTerms,
  listedSession,
  sessionStatus,
  studentEnrollmentItem,
} from './enrollments.js';

const ids = {
  subject: '0199d0a0-0000-7000-8000-000000000051',
  teacher: '0199d0a0-0000-7000-8000-0000000000c1',
  enrollment: '0199d0a0-0000-7000-8000-0000000000e1',
};

const session = {
  sessionId: '0199d0a0-0000-7000-8000-000000000d01',
  sequenceNumber: 1,
  localDate: '2026-11-08',
  startTimeLocal: '17:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-08T15:00:00.000Z',
  endsAt: '2026-11-08T15:45:00.000Z',
  status: 'scheduled',
  pendingCancellation: false,
  disputed: false,
} as const;

const summary = {
  subject: { id: ids.subject, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
} as const;

const item = {
  enrollmentId: ids.enrollment,
  teacher: {
    teacherId: ids.teacher,
    displayName: 'أحمد سالم',
    displayNameOrNull: 'أحمد سالم',
    deleted: false,
  },
  summary,
  status: 'confirmed',
  next: session,
  last: {
    ...session,
    sessionId: '0199d0a0-0000-7000-8000-000000000d08',
    sequenceNumber: 8,
    localDate: '2026-12-27',
  },
  upcoming: 8,
  completed: 0,
  remaining: 8,
  paused: false,
} as const;

describe('the tabs and the session statuses', () => {
  it('has the two tabs FR-390 names', () => {
    expect(enrollmentListTab.options).toEqual(['active', 'ended']);
  });

  // 003:T112 (DEC-90, Q-2 (a)): `postponed` joins at the end, additively (R-API-9); the case was
  // «all ten members» before it (rule d).
  it('is the ERD `session_status`, all eleven members, `postponed` at its end (003:T112)', () => {
    expect(sessionStatus.options).toEqual([
      'scheduled',
      'done',
      'student_no_show',
      'teacher_no_show',
      'both_no_show',
      'under_threshold',
      'provider_outage',
      'cancelled_by_agreement',
      'cancelled_by_admin',
      'disputed',
      'postponed',
    ]);
  });

  it('carries a session’s local date, local start, zone, instants and status (FR-393)', () => {
    expect(listedSession.parse(session)).toEqual(session);
    const { timezone: _timezone, ...withoutZone } = session;
    expect(listedSession.safeParse(withoutZone).success).toBe(false);
    expect(listedSession.safeParse({ ...session, status: 'cancelled' }).success).toBe(false);
  });

  it('carries each session’s id, so the phone opens its pre-session screen (004:T020, FR-495)', () => {
    const { sessionId: _sessionId, ...withoutId } = session;
    expect(listedSession.safeParse(withoutId).success).toBe(false);
    expect(listedSession.safeParse({ ...session, sessionId: 'session-1' }).success).toBe(false);
    expect(
      enrollmentsGetOutput.parse({
        ...item,
        sessions: [session],
        complaintOpen: false,
        ijazahRequest: null,
      }).sessions[0]?.sessionId,
    ).toBe(session.sessionId);
  });

  it('answers a disputed session as `disputed`, with no frozen outcome beside it (004:T020, R-308)', () => {
    const disputed = { ...session, status: 'disputed', outcomeUnderDispute: 'student_no_show' };
    expect(listedSession.parse(disputed)).toEqual({ ...session, status: 'disputed' });
  });

  it('carries pendingCancellation, required, true while a request is pending (004:T021, FR-456)', () => {
    const { pendingCancellation: _pending, ...without } = session;
    expect(listedSession.safeParse(without).success).toBe(false);
    expect(listedSession.parse({ ...session, pendingCancellation: true }).pendingCancellation).toBe(
      true,
    );
  });

  it('carries remedyStatus, optional, any status but lapsed (004:T028, FR-495)', () => {
    expect(listedSession.parse(session).remedyStatus).toBeUndefined();
    expect(listedSession.parse({ ...session, remedyStatus: 'awaiting_choice' }).remedyStatus).toBe(
      'awaiting_choice',
    );
    expect(listedSession.safeParse({ ...session, remedyStatus: 'lapsed' }).success).toBe(false);
  });
});

// 003:T112 (FR-POSTPONE-5, DEC-90; the coordinator's Q1 (a), 2026-11-19): a listed session carries the
// postponement that moved it, the shape `sessions.get` answers, so both enrollment screens show who
// postponed it and why from their own read. Optional, additive (R-API-9). Written before the
// field, run red first.
describe('003:T112: the postponement on a listed session', () => {
  const postponed = { ...session, status: 'postponed' } as const;
  const postponement = { by: 'student', reason: 'سفر طارئ', at: '2026-11-19T10:00:00.000Z' };

  it('carries who postponed it, the reason and when, and parses without one', () => {
    expect(listedSession.safeParse({ ...postponed, postponement }).data).toEqual({
      ...postponed,
      postponement,
    });
    const without = listedSession.safeParse(postponed);
    expect(without.success).toBe(true);
    expect(without.data?.postponement).toBeUndefined();
  });

  it('carries it on the enrollment read', () => {
    expect(
      enrollmentsGetOutput.safeParse({
        ...item,
        sessions: [{ ...postponed, postponement }],
        complaintOpen: false,
        ijazahRequest: null,
      }).data?.sessions[0]?.postponement,
    ).toEqual(postponement);
  });

  it('refuses a postponement by anyone else, a blank or over-long reason, or a time not an instant', () => {
    for (const refused of [
      { ...postponement, by: 'admin' },
      { ...postponement, reason: '' },
      { ...postponement, reason: 'ا'.repeat(501) },
      { ...postponement, at: '2026-11-19' },
    ]) {
      expect(
        listedSession.safeParse({ ...postponed, postponement: refused }).success,
        JSON.stringify(refused).slice(0, 40),
      ).toBe(false);
    }
  });
});

describe('every enrollments input names what is asked for, never who asks (R-GENDER-4)', () => {
  it('strips a gender, a user id or a role it was sent', () => {
    const sent = { gender: 'female', userId: ids.teacher, role: 'teacher' };
    expect(enrollmentsListInput.parse({ tab: 'active', ...sent })).toEqual({ tab: 'active' });
    expect(enrollmentsGetInput.parse({ enrollmentId: ids.enrollment, ...sent })).toEqual({
      enrollmentId: ids.enrollment,
    });
  });

  it('pages by an enrollment id, and refuses a tab or a cursor it does not know', () => {
    expect(enrollmentsListInput.parse({ tab: 'ended', cursor: ids.enrollment })).toEqual({
      tab: 'ended',
      cursor: ids.enrollment,
    });
    expect(enrollmentsListInput.safeParse({ tab: 'cancelled' }).success).toBe(false);
    expect(enrollmentsListInput.safeParse({ tab: 'ended', cursor: 'page-2' }).success).toBe(false);
    expect(enrollmentsGetInput.safeParse({ enrollmentId: 'not-an-id' }).success).toBe(false);
  });
});

describe('what the student is answered (FR-390, FR-392, FR-395)', () => {
  it('parses an item with its next and last sessions and the three derived counts', () => {
    expect(studentEnrollmentItem.parse(item)).toEqual(item);
  });

  it('parses an item whose teacher was deleted: no name, and deleted (T007, FR-426)', () => {
    const gone = {
      ...item,
      teacher: { teacherId: ids.teacher, displayName: '', displayNameOrNull: null, deleted: true },
    };
    expect(studentEnrollmentItem.parse(gone)).toEqual(gone);
  });

  it('parses an item awaiting payment, which has no session yet', () => {
    const { next: _next, last: _last, ...pending } = item;
    const awaiting = { ...pending, status: 'pending_payment', upcoming: 0 };
    expect(studentEnrollmentItem.parse(awaiting)).toEqual(awaiting);
  });

  it('keeps the summary to the package line the screens draw: no price, no teacher inside it', () => {
    expect(Object.keys(enrollmentTerms.shape).sort()).toEqual([
      'sessionCount',
      'sessionDurationMinutes',
      'subject',
      'track',
    ]);
    expect(
      enrollmentTerms.parse({ ...summary, price_piasters: 120_000, teacher: item.teacher }),
    ).toEqual(summary);
  });

  it('strips what no screen draws: a price, an order, a cancellation reason, a date of birth', () => {
    const answered = studentEnrollmentItem.parse({
      ...item,
      price_piasters: 120_000,
      lastOrder: { status: 'paid', reference: 'ord_1' },
      cancellationReason: 'admin',
      teacher: { ...item.teacher, dateOfBirth: '1990-01-01', photoKey: 'photos/1' },
    });
    expect(answered).toEqual(item);
  });

  // 004:T074 (FR-506; DEC-69, Q11 (a); the note under T074, Q-R7 (a)): an enrollment paused by a
  // teacher's suspension, or closed by a ban or a revocation while its slot is held, is answered
  // paused, with no reason and no session; its three counts kept. Additive (R-API-9).
  it('carries paused, required: true for a paused enrollment with no next or last session (004:T074, FR-506)', () => {
    const { paused: _paused, ...without } = item;
    expect(studentEnrollmentItem.safeParse(without).success).toBe(false);
    expect(studentEnrollmentItem.safeParse({ ...item, paused: 'yes' }).success).toBe(false);
    const { next: _next, last: _last, ...bare } = item;
    const paused = { ...bare, paused: true };
    expect(studentEnrollmentItem.parse(paused)).toEqual(paused);
    const detail = { ...paused, sessions: [], complaintOpen: false, ijazahRequest: null };
    expect(enrollmentsGetOutput.parse(detail)).toEqual(detail);
  });

  // 004:T082 (FR-513; SRS FR-CANCEL-10, DEC-68): an enrollment an administrator ended directly
  // carries the reason both parties are shown, never the internal note. Additive (R-API-9).
  it('carries endedByAdmin with the party reason only, optional (004:T082, FR-513)', () => {
    const { next: _next, last: _last, ...bare } = item;
    const ended = { ...bare, status: 'cancelled', endedByAdmin: { reason: 'انتهى الاشتراك' } };
    expect(studentEnrollmentItem.parse(ended)).toEqual(ended);
    expect(
      studentEnrollmentItem.parse({
        ...ended,
        endedByAdmin: { reason: 'انتهى الاشتراك', internalNote: 'ملاحظة داخلية' },
      }),
    ).toEqual(ended);
    expect(studentEnrollmentItem.parse(item)).toEqual(item);
    expect(studentEnrollmentItem.safeParse({ ...ended, endedByAdmin: {} }).success).toBe(false);
    const detail = { ...ended, sessions: [], complaintOpen: false, ijazahRequest: null };
    expect(enrollmentsGetOutput.parse(detail)).toEqual(detail);
  });

  it('refuses a negative count', () => {
    for (const field of ['upcoming', 'completed', 'remaining'] as const) {
      expect(studentEnrollmentItem.safeParse({ ...item, [field]: -1 }).success, field).toBe(false);
    }
  });

  it('answers a page with a cursor while more remain, and the detail with every session', () => {
    expect(enrollmentsListOutput.parse({ items: [item], nextCursor: ids.enrollment })).toEqual({
      items: [item],
      nextCursor: ids.enrollment,
    });
    expect(enrollmentsListOutput.parse({ items: [] })).toEqual({ items: [] });
    const detail = { ...item, sessions: [session], complaintOpen: false, ijazahRequest: null };
    expect(enrollmentsGetOutput.parse(detail)).toEqual(detail);
    expect(enrollmentsGetOutput.safeParse(item).success).toBe(false);
    // 004:T060 (FR-452): the detail says whether the student's complaint is open, always.
    expect(enrollmentsGetOutput.parse({ ...detail, complaintOpen: true }).complaintOpen).toBe(true);
    expect(enrollmentsGetOutput.safeParse({ ...item, sessions: [session] }).success).toBe(false);
  });

  // 005:T006 (FR-608; app-surface.md, «Enrollment reads gain»): the enrollment's ijazah request, null
  // without one; a rejection's reason is the teacher's, so the student's detail strips it.
  it('carries ijazahRequest, required and nullable, the reason stripped from the student', () => {
    const detail = { ...item, sessions: [session], complaintOpen: false };
    expect(enrollmentsGetOutput.safeParse(detail).success).toBe(false);
    expect(enrollmentsGetOutput.parse({ ...detail, ijazahRequest: null }).ijazahRequest).toBeNull();
    expect(
      enrollmentsGetOutput.parse({
        ...detail,
        ijazahRequest: { status: 'rejected', reason: 'سبب الرفض' },
      }).ijazahRequest,
    ).toEqual({ status: 'rejected' });
  });
});

// 006:T019 (B-P4's conflict check, the owner, 2026-11-25; Q-3 (a), Q-4 (a), Q-5 (b), SRS DEC-114): a
// programme's enrollment carries an optional `programme` marker (its state, `payBy` and the reminder's
// instant), so the card and the detail know it; and a programme's count (the offer's up to 200 + the
// assessment) parses: the old cap of 52 refused a 60-session offer's 61. Additive (R-API-9).
describe('006:T019: a programme’s enrollment (Q-3 (a), Q-4 (a))', () => {
  const programme = {
    state: 'offered',
    payBy: '2026-11-25T16:00:00.000Z',
    payReminderFrom: '2026-11-25T04:00:00.000Z',
  } as const;
  const ijazah = { ...item, summary: { ...summary, track: 'ijazah_track', sessionCount: 61 } };

  it('parses a 60-session offer’s enrollment (61 with the assessment), and the most, 201', () => {
    expect(studentEnrollmentItem.parse(ijazah)).toEqual(ijazah);
    expect(enrollmentTerms.parse({ ...summary, sessionCount: 201 }).sessionCount).toBe(201);
    expect(enrollmentTerms.safeParse({ ...summary, sessionCount: 202 }).success).toBe(false);
  });

  it('carries the programme marker, optional: its state, payBy and payReminderFrom', () => {
    expect(studentEnrollmentItem.parse({ ...ijazah, programme })).toEqual({ ...ijazah, programme });
    expect(studentEnrollmentItem.parse(ijazah)).not.toHaveProperty('programme');
    const active = { state: 'active', payBy: null, payReminderFrom: null } as const;
    const detail = { ...ijazah, programme: active, sessions: [], complaintOpen: false };
    expect(enrollmentsGetOutput.parse({ ...detail, ijazahRequest: null }).programme).toEqual(active);
  });

  it('refuses a marker with an unknown state, a missing payBy or a reminder not an instant', () => {
    for (const marker of [
      { ...programme, state: 'lapsed' },
      { state: 'offered', payReminderFrom: null },
      { ...programme, payReminderFrom: 'Wednesday 06:00' },
    ]) {
      expect(studentEnrollmentItem.safeParse({ ...ijazah, programme: marker }).success).toBe(false);
    }
  });
});
