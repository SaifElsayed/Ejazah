// T051 (screens.md, «Lists», decision 21 of 2026-10-17): `TeacherEnrollment`'s sessions as rows.
// Sessions of one status in a row of three or more collapse into one range; one or two stay rows of
// their own (the teacher's catalogue has no pair line). The next session is a row of its own and
// breaks a range, as both boards draw it, so a range never hides what comes next. A session with a
// pending cancellation request stands alone too, so its row can say so (004:T041, FR-495).
import type { ListedSession, SessionStatus } from '@ijazah/contracts';

export type SessionRow =
  | { readonly kind: 'one'; readonly session: ListedSession; readonly next: boolean }
  | {
      readonly kind: 'range';
      readonly first: ListedSession;
      readonly last: ListedSession;
      readonly status: SessionStatus;
    };

/** The fewest sessions of one status a range holds. */
const RANGE_FROM = 3;

/** The rows of `sessions` (by sequence number), `nextSequence` the next session's number. */
export function sessionRows(
  sessions: readonly ListedSession[],
  nextSequence: number | undefined,
): SessionRow[] {
  const rows: SessionRow[] = [];
  let run: ListedSession[] = [];
  const close = () => {
    const [first] = run;
    const last = run[run.length - 1];
    if (first !== undefined && last !== undefined && run.length >= RANGE_FROM) {
      rows.push({ kind: 'range', first, last, status: first.status });
    } else {
      for (const session of run) rows.push({ kind: 'one', session, next: false });
    }
    run = [];
  };
  for (const session of sessions) {
    if (session.sequenceNumber === nextSequence) {
      close();
      rows.push({ kind: 'one', session, next: true });
      continue;
    }
    // 004:T041 (FR-495): a session with a pending cancellation request says so on its own row.
    if (session.pendingCancellation) {
      close();
      rows.push({ kind: 'one', session, next: false });
      continue;
    }
    if (run[0] !== undefined && run[0].status !== session.status) close();
    run.push(session);
  }
  close();
  return rows;
}
