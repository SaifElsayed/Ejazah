// T021 of specs/005-certification (FR-611, FR-614; the note under T021, Q-T5 (a)): filing what the
// sheet chose, the same for both roles. «Wrong gender» is `genderFlags.raise` on the person's user
// id; any other reason `reports.create` with the place's context and its id (a session its session,
// a chat its enrollment, a profile neither). Both procedures stay as #147 built them, and the server
// still checks the pairing and the visibility (NOT_FOUND in one shape, R-GENDER-2).
//
// One idempotency key per text and kind, reused when the same text is sent again after a failure,
// and a new one once it has gone or the text has changed, as the session's reasons are keyed
// (`features/shared/sessions/keyed-reason.ts`). Both answer `{ received: true }` and nothing else
// (spec.md:305); the refusals `open_exists` and `self` are said in their own words, which name
// nothing of another person's report or flag; every other failure in T065's generic words.
import { randomUUID } from 'expo-crypto';
import { useRef } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import type { ReportPlace, ReportTarget } from './reasons';

/** `reports.create`'s and `genderFlags.raise`'s refusals (CONFLICT), each in plain words. */
const REFUSALS: ReadonlyMap<string, ErrorMessage> = new Map<string, ErrorMessage>([
  ['open_exists', { key: 'common.report.refused.openExists' }],
  ['self', { key: 'common.report.refused.self' }],
]);

/** The words for a failed filing. */
export function reportRefusal(error: unknown): ErrorMessage {
  if (errorCodeOf(error) === 'CONFLICT') {
    for (const { code } of errorDetailsOf(error)) {
      const own = REFUSALS.get(code);
      if (own !== undefined) return own;
    }
  }
  return genericErrorKey(error, 'common.state.actionError');
}

/** The context and its id as `reportsCreateInput` names them. */
function contextOf(place: ReportPlace) {
  switch (place.context) {
    case 'session':
      return { context: 'session', sessionId: place.sessionId } as const;
    case 'chat':
      return { context: 'chat', enrollmentId: place.enrollmentId } as const;
    case 'profile':
      return { context: 'profile' } as const;
  }
}

export interface FileReport {
  /** Files `text` as a gender flag when `flag`, else as a report; throws the refusal. */
  file(text: string, flag: boolean): Promise<void>;
}

export function useFileReport(target: ReportTarget): FileReport {
  const { client } = useApi();
  const keyed = useRef<{
    readonly text: string;
    readonly flag: boolean;
    readonly key: string;
  } | null>(null);
  return {
    async file(text, flag) {
      if (keyed.current?.text !== text || keyed.current.flag !== flag) {
        keyed.current = { text, flag, key: randomUUID() };
      }
      const idempotencyKey = keyed.current.key;
      if (flag) {
        await client.api.genderFlags.raise.mutate({
          flaggedUserId: target.userId,
          reason: text,
          idempotencyKey,
        });
      } else {
        await client.api.reports.create.mutate({
          reportedUserId: target.userId,
          ...contextOf(target.place),
          reason: text,
          idempotencyKey,
        });
      }
      keyed.current = null;
    },
  };
}
