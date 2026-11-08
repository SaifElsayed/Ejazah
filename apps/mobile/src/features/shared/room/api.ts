// T018 of specs/004-sessions (FR-434; contracts/app-surface.md, "`sessions`"): the session as both
// participants read it, `sessions.get`, once into the query cache: the pre-session screen draws it,
// and the room (T019) names the counterparty from the same answer. The routes of both roles are the
// role feature's (`features/student/sessions/`, `features/teacher/sessions/`).
import { type SessionsGetOutput, sessionsGetInput } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';

export const sessionQueryKey = (sessionId: string) => ['sessions', 'get', sessionId] as const;

/** Whether `sessionId` can name a session at all (the procedure's own input). */
export function isSessionId(sessionId: string): boolean {
  return sessionsGetInput.safeParse({ sessionId }).success;
}

/** `sessions.get` for `sessionId`; idle when the link names no session. */
export function useSessionRead(sessionId: string) {
  const { client } = useApi();
  return useQuery<SessionsGetOutput>({
    queryKey: sessionQueryKey(sessionId),
    queryFn: () => client.api.sessions.get.query({ sessionId }),
    enabled: isSessionId(sessionId),
  });
}
