// T043 of specs/004-sessions (FR-495; the note under T041, Q3 (a)): a session row's remedy, from the
// lists' `remedyStatus`, in the student's words; nothing for a session without one.
import type { ListedSession } from '@ijazah/contracts';
import { View } from 'react-native';

import { Badge } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { remedyRowKey } from '../remedy';

export function RemedyStatusLine({ status }: { readonly status: ListedSession['remedyStatus'] }) {
  const t = useT();
  const line = remedyRowKey(status);
  if (line === undefined) return null;
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Badge label={t(line.key)} tone={line.tone} />
    </View>
  );
}
