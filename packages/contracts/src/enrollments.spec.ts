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
} as const;

describe('the tabs and the session statuses', () => {
  it('has the two tabs FR-390 names', () => {
    expect(enrollmentListTab.options).toEqual(['active', 'ended']);
  });

  it('is the ERD `session_status`, all ten members', () => {
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
    expect(enrollmentsGetOutput.parse({ ...item, sessions: [session] }).sessions[0]?.sessionId).toBe(
      session.sessionId,
    );
  });

  it('answers a disputed session as `disputed`, with no frozen outcome beside it (004:T020, R-308)', () => {
    const disputed = { ...session, status: 'disputed', outcomeUnderDispute: 'student_no_show' };
    expect(listedSession.parse(disputed)).toEqual({ ...session, status: 'disputed' });
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
    const detail = { ...item, sessions: [session] };
    expect(enrollmentsGetOutput.parse(detail)).toEqual(detail);
    expect(enrollmentsGetOutput.safeParse(item).success).toBe(false);
  });
});
