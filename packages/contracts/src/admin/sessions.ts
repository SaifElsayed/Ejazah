// T016 of specs/004-sessions (FR-445, FR-480, FR-495; R-TIME-6; research R-307): the administrator
// surface's `sessions.outages` procedures (admin-surface.md, "`sessions`"). A window during which
// the video provider was out, recorded by an administrator with the second factor and a mandatory
// reason (LiveKit Cloud sends no outage event, ADR 0003). The window crosses as the administrator's
// local date and time and an IANA zone, never an instant (R-TIME-6, `time/no-client-timestamp`):
// the server resolves both ends with `packages/time`. A recorded window is never edited (data-model
// §2.5, rule 44); no procedure here changes or removes one.
import { z } from 'zod';

import { calendarDate, timeZone } from '../onboarding.js';
import { slotStartTimeLocal } from '../slots.js';
import { adminReason } from './admins.js';

/** One end of the window: a calendar date and a wall-clock time (`HH:MM`), in the input's zone. */
export const outageWallClock = z.object({ localDate: calendarDate, localTime: slotStartTimeLocal });

export const outagesRecordInput = z.object({
  start: outageWallClock,
  end: outageWallClock,
  timezone: timeZone,
  reason: adminReason,
});

export const outagesRecordOutput = z.object({
  outageId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** The settled sessions inside their dispute window this record moved to `provider_outage`. */
  reclassified: z.int().nonnegative(),
});

/** A page of the list starts after this window; windows are listed by their time-ordered id. */
export const outagesListCursor = z.uuid();

export const outagesListInput = z.object({ cursor: outagesListCursor.optional() });

/** The administrator who recorded a window. */
export const outageRecorder = z.object({ adminId: z.uuid(), displayName: z.string() });

export const outagesListItem = z.object({
  outageId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string(),
  recordedBy: outageRecorder,
});

export const outagesListOutput = z.object({
  items: z.array(outagesListItem),
  /** Present while more windows follow the page. */
  nextCursor: outagesListCursor.optional(),
});

// T023 of specs/004-sessions (FR-460, FR-480, FR-485; SC-413; admin-surface.md, `sessions.cancel`):
// an administrator's cancellation of a session not yet settled, with a mandatory reason. The
// session becomes `cancelled_by_admin` with no penalty, and one `admin_cancellation` compensation
// case on its enrollment is opened or joined; its id is answered as `caseId`. Only a `scheduled`
// session is cancelled: any other, a `disputed` one included (its ruling is FR-476's path), is
// refused `SESSION_NOT_SCHEDULED`; a session that does not exist is `NOT_FOUND`.
export const sessionsCancelInput = z.object({ sessionId: z.uuid(), reason: adminReason });

export const sessionsCancelOutput = z.object({
  sessionId: z.uuid(),
  status: z.literal('cancelled_by_admin'),
  /** The `admin_cancellation` case opened, or the open one joined. */
  caseId: z.uuid(),
});

export type SessionsCancelInput = z.infer<typeof sessionsCancelInput>;
export type SessionsCancelOutput = z.infer<typeof sessionsCancelOutput>;
