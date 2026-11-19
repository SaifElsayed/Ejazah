// 003:T112 (SRS FR-POSTPONE-5, DEC-90): the postponement that moved a session, as the lists and
// `sessions.get` answer it (`sessionPostponement`), on the session's row or screen for both parties:
// which party postponed it, worded for the viewer («بطلبك» for their own), and its reason, the
// party's own text. Nothing while no postponement moved the session.
import type { SessionPostponement } from '@ijazah/contracts';

import { Text } from '../../../../design/primitives';
import { type MessageKey, useT } from '../../../../i18n';
import type { PartyRole } from '../../../../lib/party';

function wordsOf(by: PartyRole, viewer: PartyRole): MessageKey {
  if (by === viewer) return 'postponement.shown.byMe';
  return by === 'teacher' ? 'postponement.shown.byTeacher' : 'postponement.shown.byStudent';
}

export function PostponementLine({
  postponement,
  viewer,
}: {
  readonly postponement: SessionPostponement | undefined;
  /** Who reads it: their own postponement is said as theirs. */
  readonly viewer: PartyRole;
}) {
  const t = useT();
  if (postponement === undefined) return null;
  return (
    <Text variant="caption" tone="muted">
      {t(wordsOf(postponement.by, viewer), { reason: postponement.reason })}
    </Text>
  );
}
