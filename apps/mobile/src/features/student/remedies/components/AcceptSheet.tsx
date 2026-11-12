// T043 of specs/004-sessions (FR-465, FR-466): the proposal accepted, `sessions.remedy.accept`. The
// sheet shows the proposal in its zone and the viewer's and says that the make-up is booked there,
// and, with a counter-proposal pending, that it is withdrawn (the owner's decision of 2026-11-05).
import type { RemedyView, SessionsGetOutput } from '@ijazah/contracts';

import { Button, Sheet, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { ZoneLines } from '../../../shared/room/components/ZoneLines';
import { useRemedyActions } from '../api';
import { Failure } from './Failure';
import { useSend } from './use-send';

export function AcceptSheet({
  session,
  proposal,
  withdrawsCounter,
  viewerZone,
  onClose,
}: {
  readonly session: SessionsGetOutput;
  readonly proposal: NonNullable<RemedyView['proposal']>;
  readonly withdrawsCounter: boolean;
  readonly viewerZone: string;
  readonly onClose: () => void;
}) {
  const t = useT();
  const actions = useRemedyActions(session);
  const { busy, failure, send } = useSend(onClose);
  return (
    <Sheet open onClose={onClose} title={t('student.remedy.accept')}>
      <Failure failure={failure} />
      <ZoneLines
        instant={proposal.startsAt}
        sessionZone={proposal.timezone}
        viewerZone={viewerZone}
      />
      <Text>{t('student.remedy.acceptSheet.text')}</Text>
      {withdrawsCounter ? (
        <Text tone="muted">{t('student.remedy.acceptSheet.withdraws')}</Text>
      ) : null}
      <Button
        label={t('student.remedy.acceptSheet.confirm')}
        layout="block"
        loading={busy}
        disabled={busy}
        onPress={() => void send(() => actions.accept())}
      />
      <Button label={t('common.action.cancel')} variant="ghost" layout="block" onPress={onClose} />
    </Sheet>
  );
}
