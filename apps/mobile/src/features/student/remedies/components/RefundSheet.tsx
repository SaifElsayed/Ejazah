// T043 of specs/004-sessions (FR-463, FR-467; SC-410): the refund chosen, `sessions.remedy.choose`.
// A refund is handed to a compensation case the administration decides, and carries no amount: the
// sheet says so and shows no figure (the note under T043, Q5).
import type { SessionsGetOutput } from '@ijazah/contracts';

import { Button, Sheet, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useRemedyActions } from '../api';
import { Failure } from './Failure';
import { useSend } from './use-send';

export function RefundSheet({
  session,
  onClose,
}: {
  readonly session: SessionsGetOutput;
  readonly onClose: () => void;
}) {
  const t = useT();
  const actions = useRemedyActions(session);
  const { busy, failure, send } = useSend(onClose);
  return (
    <Sheet open onClose={onClose} title={t('student.remedy.refundSheet.title')}>
      <Failure failure={failure} />
      <Text>{t('student.remedy.refundSheet.text')}</Text>
      <Button
        label={t('student.remedy.refundSheet.confirm')}
        layout="block"
        loading={busy}
        disabled={busy}
        onPress={() => void send(() => actions.chooseRefund())}
      />
      <Button label={t('common.action.cancel')} variant="ghost" layout="block" onPress={onClose} />
    </Sheet>
  );
}
