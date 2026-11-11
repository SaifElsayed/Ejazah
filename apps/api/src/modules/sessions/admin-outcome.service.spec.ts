// T033 of specs/004-sessions/tasks.md (FR-450, FR-495; research R-308; the note under T033, «one
// writer of an administrator's outcome») — `writeAdminOutcome` over a recorded store: the outcome
// written from the status read under the caller's locks, then one event row whose columns its kind
// sets (rule 43): none beyond the session for `review_resolved` and `dispute_resolved`, the dispute
// and both outcomes for `dispute_revised`, both outcomes for `outcome_corrected`; a session no longer
// in that status thrown as a broken invariant, no event written. Over the real tables:
// `tests/db-integrity/session-review.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { AdminSettlement } from './admin-outcome.repository.js';
import {
  type AdminOutcomeEvent,
  type AdminOutcomeStore,
  writeAdminOutcome,
} from './admin-outcome.service.js';
import type { SessionEventRecord } from './session-events.repository.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const AT = new Date('2026-11-10T09:00:00Z');

function recorded(moves = true) {
  const settled: AdminSettlement[] = [];
  const events: SessionEventRecord[] = [];
  const store: AdminOutcomeStore = {
    settleByAdmin: async (_tx, settlement) => {
      settled.push(settlement);
      return moves;
    },
    recordEvents: async (_tx, rows) => {
      events.push(...rows);
    },
  };
  return { store, settled, events };
}

const write = (event: AdminOutcomeEvent) => ({
  sessionId: SESSION,
  enrollmentId: ENROLLMENT,
  from: 'disputed' as const,
  outcome: 'teacher_no_show' as const,
  adminId: ADMIN,
  at: AT,
  event,
});

const base = { enrollmentId: ENROLLMENT, sessionId: SESSION, occurredAt: AT };

describe('writeAdminOutcome', () => {
  it.each<[AdminOutcomeEvent, SessionEventRecord]>([
    [{ kind: 'review_resolved' }, { ...base, kind: 'review_resolved' }],
    [{ kind: 'dispute_resolved' }, { ...base, kind: 'dispute_resolved' }],
    [
      { kind: 'dispute_revised', disputeId: DISPUTE, outcomeBefore: 'done' },
      {
        ...base,
        kind: 'dispute_revised',
        caseId: DISPUTE,
        outcomeBefore: 'done',
        outcomeAfter: 'teacher_no_show',
      },
    ],
    [
      { kind: 'outcome_corrected', outcomeBefore: 'both_no_show' },
      {
        ...base,
        kind: 'outcome_corrected',
        outcomeBefore: 'both_no_show',
        outcomeAfter: 'teacher_no_show',
      },
    ],
  ])('writes the outcome from the status read, then the %o row', async (event, row) => {
    const { store, settled, events } = recorded();
    await writeAdminOutcome(tx, write(event), store);
    expect(settled).toEqual([
      { id: SESSION, from: 'disputed', outcome: 'teacher_no_show', adminId: ADMIN, at: AT },
    ]);
    expect(events).toEqual([row]);
  });

  it('writes a dispute upheld over a frozen under_threshold back to it, the session again in the queue (R-308)', async () => {
    const { store, settled, events } = recorded();
    await writeAdminOutcome(
      tx,
      { ...write({ kind: 'dispute_resolved' }), outcome: 'under_threshold' },
      store,
    );
    expect(settled[0]?.outcome).toBe('under_threshold');
    expect(events).toEqual([{ ...base, kind: 'dispute_resolved' }]);
  });

  it.each<AdminOutcomeEvent>([
    { kind: 'dispute_revised', disputeId: DISPUTE, outcomeBefore: 'done' },
    { kind: 'outcome_corrected', outcomeBefore: 'done' },
  ])('refuses a $kind row naming a status under review as its outcome (rule 43)', async (event) => {
    const { store, events } = recorded();
    await expect(
      writeAdminOutcome(tx, { ...write(event), outcome: 'provider_outage' }, store),
    ).rejects.toThrow('a revision wrote a status under review');
    expect(events).toEqual([]);
  });

  it('throws when the session moved from the status read under the locks, writing no event', async () => {
    const { store, events } = recorded(false);
    await expect(writeAdminOutcome(tx, write({ kind: 'review_resolved' }), store)).rejects.toThrow(
      'a locked session changed under its locks',
    );
    expect(events).toEqual([]);
  });
});
