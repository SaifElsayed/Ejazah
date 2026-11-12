// T044 of specs/004-sessions (FR-495): a session row's remedy on the teacher's enrollment screen,
// in the teacher's words (`remedy-rows.ts`); nothing for a session without one.
import type { ListedSession } from '@ijazah/contracts';
import { View } from 'react-native';

import { Badge } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { teacherRemedyRowKey } from '../remedy-rows';

export function TeacherRemedyStatusLine({
  status,
}: {
  readonly status: ListedSession['remedyStatus'];
}) {
  const t = useT();
  const line = teacherRemedyRowKey(status);
  if (line === undefined) return null;
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Badge label={t(line.key)} tone={line.tone} />
    </View>
  );
}
