// T051 — the integrity rules of the model, each shown by an insert the database rejects (SC-007).
//
// "All nine original integrity rules" is read as ERD §15 rules 1–9. Rules 5 and 6 belonged to the
// managed-payment tables ADR 0005 D1 removed and have no table left to probe, so seven are probed
// here: 1, 2, 3, 4, 7, 8 and 9. The later rules have their own suites: 10 is T050 and T054, 11 is
// T053, 13 and 14 are T052, 17–19 are T142, and 22 to 32 are T008 (Phase 1). Rule 4 is also in
// T052 as a replay probe; it stays here because it is one of the nine. Rule 7 is probed as ADR
// 0017 re-keyed it (data-model.md §5 rule 28, T008): a chain hangs under a credential, one
// generation per position, so the probe plants a credential first.
//
// Each probe first writes a valid row, so a rejection is the rule and not a broken row, and then
// the forbidden one, expecting the SQLSTATE of the constraint kind: 23514 for a check, 23505 for a
// unique. Every probe runs as the application role in a transaction that is rolled back.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  enrollmentValues,
  inRollback,
  insertStatement,
  makeAdmin,
  makeCredential,
  makeEnrollment,
  makeOffer,
  makeSession,
  makeSubject,
  makeUser,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** The SQLSTATE an insert of `values` into `table` is refused with, or null when accepted. */
async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, table, values);
  return attempt(db, sql, params);
}

describe('ERD §15 rules 1–9, each refused by the database (T051, SC-007)', () => {
  it('rule 1: a user with neither phone nor email is refused', async () => {
    await inRollback(db, async () => {
      expect(
        await tryInsert('users', userValues({ email: 'probe@example.invalid', phone: null })),
      ).toBeNull();
      expect(await tryInsert('users', userValues({ email: null, phone: null }))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('rule 2: an enrollment whose student is its teacher is refused (FR-BOOK-11)', async () => {
    await inRollback(db, async () => {
      const offer = await makeOffer(db);
      const student = await makeUser(db);
      expect(await tryInsert('enrollments', enrollmentValues(offer, student))).toBeNull();
      expect(await tryInsert('enrollments', enrollmentValues(offer, offer.teacherId))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('rule 3: a second review of one enrollment is refused', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const review = reviewValues(enrollment, 5);
      expect(await tryInsert('reviews', review)).toBeNull();
      expect(await tryInsert('reviews', review)).toBe(SQLSTATE.uniqueViolation);
    });
  });

  it('rule 4: a replayed provider attendance event is refused', async () => {
    await inRollback(db, async () => {
      const session = await makeSession(db);
      const event = {
        session_id: session.sessionId,
        user_id: session.studentId,
        event_type: 'joined',
        occurred_at: '2026-10-04T06:00:05Z',
        provider_event_id: 'probe-event-1',
      };
      expect(await tryInsert('session_participant_events', event)).toBeNull();
      expect(await tryInsert('session_participant_events', event)).toBe(SQLSTATE.uniqueViolation);
    });
  });

  it('rule 7 (28 as re-keyed): a second generation at one position of a chain is refused', async () => {
    await inRollback(db, async () => {
      const teacher = await makeUser(db);
      const subject = await makeSubject(db);
      const admin = await makeAdmin(db);
      const credential = await makeCredential(db, {
        teacherId: teacher,
        subjectId: subject,
        status: 'approved',
        admin,
      });
      const entry = (names: readonly string[]) => ({
        credential_id: credential,
        position: 1,
        names: [...names],
        created_by_admin_id: admin,
      });
      expect(await tryInsert('isnad_entries', entry(['First']))).toBeNull();
      expect(await tryInsert('isnad_entries', entry(['Second', 'Third']))).toBe(
        SQLSTATE.uniqueViolation,
      );
    });
  });

  // PR #77 review: the check behind rule 28's second half, a generation holds one or more names.
  it('rule 28: a generation with no name, or a null one, is refused', async () => {
    await inRollback(db, async () => {
      const teacher = await makeUser(db);
      const subject = await makeSubject(db);
      const admin = await makeAdmin(db);
      const credential = await makeCredential(db, {
        teacherId: teacher,
        subjectId: subject,
        status: 'approved',
        admin,
      });
      const entry = (names: readonly string[] | null) => ({
        credential_id: credential,
        position: 2,
        names: names === null ? null : [...names],
        created_by_admin_id: admin,
      });
      expect(await tryInsert('isnad_entries', entry([]))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('isnad_entries', entry(null))).toBe(SQLSTATE.checkViolation);
      expect(await tryInsert('isnad_entries', entry(['Fourth']))).toBeNull();
    });
  });

  it('rule 8: a chat message with neither body nor attachment is refused', async () => {
    await inRollback(db, async () => {
      const enrollment = await makeEnrollment(db);
      const message = (body: string | null) => ({
        enrollment_id: enrollment.enrollmentId,
        sender_user_id: enrollment.studentId,
        body,
        attachment_key: null,
        sent_at: '2026-10-04T06:10:00Z',
      });
      expect(await tryInsert('chat_messages', message('Salam'))).toBeNull();
      expect(await tryInsert('chat_messages', message(null))).toBe(SQLSTATE.checkViolation);
    });
  });

  it('rule 9: a rating outside 1–5 is refused', async () => {
    await inRollback(db, async () => {
      for (const rating of [1, 5]) {
        const enrollment = await makeEnrollment(db);
        expect(
          await tryInsert('reviews', reviewValues(enrollment, rating)),
          String(rating),
        ).toBeNull();
      }
      for (const rating of [0, 6, -1]) {
        const enrollment = await makeEnrollment(db);
        expect(await tryInsert('reviews', reviewValues(enrollment, rating)), String(rating)).toBe(
          SQLSTATE.checkViolation,
        );
      }
    });
  });
});

function userValues(contact: {
  phone: string | null;
  email: string | null;
}): Record<string, unknown> {
  return {
    ...contact,
    gender: 'female',
    date_of_birth: '1995-05-05',
    display_name: 'Probe user',
    preferred_language: 'ar',
    timezone: 'Africa/Cairo',
    account_status: 'active',
  };
}

function reviewValues(
  enrollment: { enrollmentId: string; studentId: string; teacherId: string },
  rating: number,
): Record<string, unknown> {
  return {
    enrollment_id: enrollment.enrollmentId,
    student_user_id: enrollment.studentId,
    teacher_user_id: enrollment.teacherId,
    rating,
  };
}
