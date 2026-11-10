// T026 of specs/004-sessions/tasks.md (FR-473, FR-495; contracts/app-surface.md, `sessions.get`'s
// `dispute`, `canRaiseDispute` and `disputeClosesAt`, and Phase 2's lists' `disputed`): what the
// parties' screens read of a session's dispute. The main session joins these fields to
// `sessions.get` and the lists at the integration, after T021's (the B37 row of tasks.md's
// «Batches»); this file answers them and touches neither output.
//
// - `disputeClosesAt`: the session's window close, `endsAt + dispute_window_hours`, for every session
//   that can be disputed or is under review or disputed; none for a cancelled session, which has no
//   window (FR-473; completion reads the same window, `completion.service.ts`).
// - `canRaiseDispute`: whether `sessions.dispute.raise` would take the session now, by the rules
//   `dispute-raise.service.ts` applies under its locks (a disputable status and the database's clock
//   inside `[endsAt, close)`); read with no lock, so it is the screen's hint and the raise decides.
// - `dispute`: the session's latest session dispute, open or closed (a resolved one stays named
//   while a second may be raised, G1): its status, whether the viewer raised it, and the window's
//   close. The parties never see the frozen outcome (`status` stays `disputed`, app-surface.md).
// - The lists' `disputed`: the session's status is `disputed` (`isDisputed`).
//
// Read for any number of sessions in one call (`ofSessions`): the window once, the database's clock
// once, and the latest disputes of all of them through moderation's entry in one read (R-API-6), so
// a list asks no question per row.
import type { SessionStatus } from '@ijazah/contracts';
import { addHours } from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { latestSessionDisputesOf, type SessionDisputeState } from '../moderation/index.js';
import { DISPUTE_WINDOW_SETTING, disputeWindowHours } from './completion.service.js';
import { DISPUTABLE_STATUSES } from './dispute-raise.repository.js';

/** The dispute fields of one session, as `sessions.get` answers them. */
export interface SessionDisputeFields {
  readonly dispute?: {
    readonly status: SessionDisputeState['status'];
    readonly raisedByMe: boolean;
    readonly closesAt: string;
  };
  readonly canRaiseDispute: boolean;
  readonly disputeClosesAt?: string;
}

/** What the fields read of a session. */
export interface DisputedSession {
  readonly status: SessionStatus;
  readonly endsAt: Date;
}

const CANCELLED: ReadonlySet<SessionStatus> = new Set([
  'cancelled_by_agreement',
  'cancelled_by_admin',
]);
const DISPUTABLE: ReadonlySet<SessionStatus> = new Set(DISPUTABLE_STATUSES);

/**
 * The session's dispute fields, for `viewerUserId`, at the database's instant `at`, under a window of
 * `windowHours`; `latest` is the session's latest session dispute, if any.
 */
export function disputeFieldsOf(
  session: DisputedSession,
  latest: SessionDisputeState | undefined,
  viewerUserId: string,
  at: Date,
  windowHours: number,
): SessionDisputeFields {
  if (CANCELLED.has(session.status)) return { canRaiseDispute: false };
  const closesAt = new Date(addHours(session.endsAt, windowHours));
  const disputeClosesAt = closesAt.toISOString();
  const canRaiseDispute =
    DISPUTABLE.has(session.status) &&
    at.getTime() >= session.endsAt.getTime() &&
    at.getTime() < closesAt.getTime();
  return {
    ...(latest === undefined
      ? {}
      : {
          dispute: {
            status: latest.status,
            raisedByMe: latest.raisedByUserId === viewerUserId,
            closesAt: disputeClosesAt,
          },
        }),
    canRaiseDispute,
    disputeClosesAt,
  };
}

/** The lists' `disputed`: the session's status is `disputed`. */
export function isDisputed(status: SessionStatus): boolean {
  return status === 'disputed';
}

/** The fields of several sessions, read together. */
export interface DisputeView {
  /** Each session's dispute fields for `viewerUserId`, by session id; no lock. */
  ofSessions(
    tx: Transaction,
    sessions: readonly (DisputedSession & { readonly id: string })[],
    viewerUserId: string,
  ): Promise<ReadonlyMap<string, SessionDisputeFields>>;
}

export function createDisputeView({
  settings,
  clock = clockTimestamp,
  latestOf = latestSessionDisputesOf,
}: {
  readonly settings: SettingsReader;
  /** The database's clock on the read's transaction; `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  /** Moderation's latest session disputes of some sessions (`latestSessionDisputesOf`). */
  readonly latestOf?: (
    tx: Transaction,
    sessionIds: readonly string[],
  ) => Promise<ReadonlyMap<string, SessionDisputeState>>;
}): DisputeView {
  return {
    ofSessions: async (tx, sessions, viewerUserId) => {
      const fields = new Map<string, SessionDisputeFields>();
      if (sessions.length === 0) return fields;
      const hours = await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
      const at = await clock(tx);
      const latest = await latestOf(
        tx,
        sessions.map(({ id }) => id),
      );
      for (const session of sessions) {
        fields.set(
          session.id,
          disputeFieldsOf(session, latest.get(session.id), viewerUserId, at, hours),
        );
      }
      return fields;
    },
  };
}
