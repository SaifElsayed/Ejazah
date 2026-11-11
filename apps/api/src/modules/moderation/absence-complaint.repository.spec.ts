// T060 of specs/004-sessions (FR-452; research R-322, «The complaint»; ERD §15 rule 46) — the
// complaint's two queries over a stand-in client, every branch: the insert writes an open
// `absence_complaint` raised by the student, with their text and no session, and answers its id,
// null when the database refuses it by the one-open rule
// (`disputes_one_open_complaint_per_enrollment_key`), any other refusal thrown as it is; the open
// complaint's read asks for the enrollment's one open complaint and answers its id, null for none.
// What the database itself refuses is `tests/db-integrity/absence-complaint.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { openAbsenceComplaint } from './absence-complaint.service.js';
import { openComplaintOf } from './absence-complaint.repository.js';

const COMPLAINT = '0199d0a0-0000-7000-8000-0000000000f1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000c1';
const REASON = 'غاب المعلم عن ثلاث حصص';

/** The adapter's refusal by the unique index `index`, as `db-errors.ts` reads it. */
function uniqueRefusal(index: string) {
  return {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '23505',
      originalMessage: `duplicate key value violates unique constraint "${index}"`,
      constraint: { index },
    },
  };
}

type Tx = Parameters<typeof openAbsenceComplaint>[0];

function client({
  create = async () => ({ id: COMPLAINT }),
  found = null,
}: {
  create?: (args: unknown) => Promise<{ id: string }>;
  found?: { id: string } | null;
} = {}) {
  const asked: unknown[] = [];
  const stand = {
    dispute: {
      create: async (args: unknown) => {
        asked.push(['create', args]);
        return create(args);
      },
      findFirst: async (args: unknown) => {
        asked.push(['findFirst', args]);
        return found;
      },
    },
  };
  return { asked, tx: stand as unknown as Tx };
}

describe('openAbsenceComplaint', () => {
  it('inserts an open absence_complaint raised by the student, with no session, and answers its id', async () => {
    const { asked, tx } = client();
    expect(await openAbsenceComplaint(tx, ENROLLMENT, STUDENT, REASON)).toBe(COMPLAINT);
    expect(asked).toEqual([
      [
        'create',
        {
          data: {
            enrollmentId: ENROLLMENT,
            raisedByUserId: STUDENT,
            reason: REASON,
            kind: 'absence_complaint',
            status: 'open',
          },
          select: { id: true },
        },
      ],
    ]);
  });

  it('answers null when the one-open rule refuses it', async () => {
    const { tx } = client({
      create: async () => {
        throw uniqueRefusal('disputes_one_open_complaint_per_enrollment_key');
      },
    });
    expect(await openAbsenceComplaint(tx, ENROLLMENT, STUDENT, REASON)).toBeNull();
  });

  it('throws any other refusal as it is', async () => {
    const other = uniqueRefusal('disputes_one_open_per_session_key');
    const { tx } = client({
      create: async () => {
        throw other;
      },
    });
    await expect(openAbsenceComplaint(tx, ENROLLMENT, STUDENT, REASON)).rejects.toBe(other);
  });
});

describe('openComplaintOf', () => {
  it('reads the enrollment’s open complaint and answers its id', async () => {
    const { asked, tx } = client({ found: { id: COMPLAINT } });
    expect(await openComplaintOf(tx, ENROLLMENT)).toBe(COMPLAINT);
    expect(asked).toEqual([
      [
        'findFirst',
        {
          where: { enrollmentId: ENROLLMENT, kind: 'absence_complaint', status: 'open' },
          select: { id: true },
        },
      ],
    ]);
  });

  it('answers null when none is open', async () => {
    const { tx } = client();
    expect(await openComplaintOf(tx, ENROLLMENT)).toBeNull();
  });
});
