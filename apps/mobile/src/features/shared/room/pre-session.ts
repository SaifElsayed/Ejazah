// T018 of specs/004-sessions (FR-434, FR-433, FR-431): what the pre-session screen decides on, so
// the screen only draws (R-MOBILE-12). The join is offered while the period is open by the phone's
// clock, the session is still `scheduled`, and the microphone is granted: every session has audio
// (FR-433). The server decides again at `sessions.join` (`JOIN_NOT_OPEN`, `JOIN_CLOSED`,
// `SESSION_NOT_SCHEDULED`), which the room calls (T019); this screen asks for no token.
import type { SessionsGetOutput, SessionStatus } from '@ijazah/contracts';

import type { MessageKey } from '../../../i18n';
import { type JoinWindow, useJoinWindow } from './join-window';
import { type Microphone, useMicrophone } from './permissions';

/** A session's status as the pre-session screen says it when it is no longer `scheduled`. */
export const SESSION_STATUS_LABEL: Readonly<Record<SessionStatus, MessageKey>> = {
  scheduled: 'status.session.scheduled',
  done: 'status.session.done',
  student_no_show: 'status.session.studentNoShow',
  teacher_no_show: 'status.session.teacherNoShow',
  both_no_show: 'status.session.bothNoShow',
  under_threshold: 'status.session.underReview',
  provider_outage: 'status.session.underReview',
  cancelled_by_agreement: 'status.session.cancelledByAgreement',
  cancelled_by_admin: 'status.session.cancelledByAdmin',
  disputed: 'status.session.disputed',
  // 003:T112 (FR-POSTPONE-5): a session its party postponed.
  postponed: 'status.session.postponed',
};

export interface PreSession {
  readonly window: JoinWindow;
  readonly microphone: Microphone;
  /** The period has closed or the session is no longer `scheduled`. */
  readonly unavailable: boolean;
  readonly canJoin: boolean;
}

export function usePreSession(session: SessionsGetOutput): PreSession {
  const window = useJoinWindow(session.join);
  const microphone = useMicrophone();
  const unavailable = window === 'closed' || session.status !== 'scheduled';
  const canJoin = !unavailable && window === 'open' && microphone.access === 'granted';
  return { window, microphone, unavailable, canJoin };
}
