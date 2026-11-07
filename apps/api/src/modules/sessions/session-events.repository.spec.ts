// T004 of specs/004-sessions/tasks.md (FR-495; research R-315) — sessions' one writer of
// `session_events`, over a recorded client: no event sends no statement, and the events are written
// in one statement, each as given. The same over the real table, append-only for the application
// role (ERD §15 rule 43), is `tests/db-integrity/sessions-pass.spec.ts`'s. Added after PR #127's CI
// (the follow-up under T004): the pipeline's coverage step leaves the db-integrity specs out.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { recordSessionEvents, type SessionEventRecord } from './session-events.repository.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const AT = new Date('2026-11-07T10:00:00Z');

describe('recordSessionEvents (T004)', () => {
  it('sends no statement for no event', async () => {
    const untouched = new Proxy({} as Pick<Transaction, 'sessionEvent'>, {
      get: (_target, property) => {
        throw new Error(`the client was used: ${String(property)}`);
      },
    });
    await expect(recordSessionEvents(untouched, [])).resolves.toBeUndefined();
  });

  it('writes every event in one statement, each row as given', async () => {
    const calls: unknown[] = [];
    const tx = {
      sessionEvent: {
        createMany: async (args: unknown) => {
          calls.push(args);
          return { count: 2 };
        },
      },
    } as unknown as Pick<Transaction, 'sessionEvent'>;
    const events: SessionEventRecord[] = [
      {
        enrollmentId: id(1),
        sessionId: id(11),
        kind: 'cancelled_by_admin',
        caseId: id(31),
        occurredAt: AT,
      },
      { enrollmentId: id(1), sessionId: id(12), kind: 'remedy_lapsed', occurredAt: AT },
    ];
    await recordSessionEvents(tx, events);
    expect(calls).toEqual([{ data: events }]);
    const [{ data }] = calls as [{ data: SessionEventRecord[] }];
    expect(data[0]).not.toBe(events[0]);
  });
});
