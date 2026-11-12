// T042 of specs/004-sessions (FR-473, FR-474, FR-494, FR-495; SRS FR-DISPUTE-1): a session's dispute
// on its screen, the same for both roles (R-MOBILE-3; the note under T042, Q1 (a)): each role's
// session wrapper places it in the session screen's slot. From `sessions.get`: the latest dispute's
// state (`dispute`: open, by the viewer or the other party, resolved or dismissed); while
// `canRaiseDispute`, the control with the window's close (`disputeClosesAt`) in the session's zone
// and the viewer's (`ZoneLines`) and a free-text reason (Q4). Refusals in the screen's words or
// through `genericErrorKey` (`disputeRefusal`). The hooks and the server decide; this draws.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import type { ErrorMessage } from '../../../../lib/error-message';
import { useSessionRead } from '../../room/api';
import { ZoneLines } from '../../room/components/ZoneLines';
import { disputeRaiseShown, disputeRefusal, useRaiseDispute } from '../dispute';
import { ReasonForm } from './ReasonForm';

type DisputeView = NonNullable<SessionsGetOutput['dispute']>;

/** The session's dispute panel, from `sessions.get` for `sessionId`; nothing until it is read. */
export function DisputePanel({ sessionId }: { readonly sessionId: string }) {
  const t = useT();
  const read = useSessionRead(sessionId);
  const viewerZone = useMe().data?.timezone;
  if (read.data === undefined || viewerZone === undefined) return null;
  const session = read.data;
  const raiseShown = disputeRaiseShown(session);
  if (session.dispute === undefined && !raiseShown) return null;
  return (
    <Card variant="surface">
      {session.dispute === undefined ? null : (
        <Text weight="medium">{t(stateKey(session.dispute))}</Text>
      )}
      {raiseShown ? <RaiseControl session={session} viewerZone={viewerZone} /> : null}
    </Card>
  );
}

/** The latest dispute's state as the parties read it; never the outcome frozen beside it (R-308). */
function stateKey(dispute: DisputeView): MessageKey {
  if (dispute.status === 'resolved') return 'session.dispute.state.resolved';
  if (dispute.status === 'dismissed') return 'session.dispute.state.dismissed';
  return dispute.raisedByMe ? 'session.dispute.state.openMine' : 'session.dispute.state.openTheirs';
}

function RaiseControl({
  session,
  viewerZone,
}: {
  readonly session: SessionsGetOutput;
  readonly viewerZone: string;
}) {
  const t = useT();
  const disputes = useRaiseDispute(session);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  async function send(text: string): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      if ((await disputes.raise(text)) !== undefined) setOpen(false);
    } catch (caught: unknown) {
      setFailure(disputeRefusal(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: tokens.space['3'] }}>
      {session.disputeClosesAt === undefined ? null : (
        <View style={{ gap: tokens.space['1'] }}>
          <Text variant="caption">{t('session.dispute.closesAt')}</Text>
          <ZoneLines
            instant={session.disputeClosesAt}
            sessionZone={session.timezone}
            viewerZone={viewerZone}
          />
        </View>
      )}
      {open ? (
        <ReasonForm
          words={{
            label: t('session.dispute.form.reason'),
            hint: t('session.dispute.form.hint'),
            send: t('session.dispute.form.send'),
            back: t('session.dispute.form.back'),
            tooLong: t('session.dispute.form.tooLong'),
          }}
          busy={busy}
          failure={failure === undefined ? undefined : t(failure.key, failure.values)}
          onSend={(text) => void send(text)}
          onBack={() => {
            setOpen(false);
            setFailure(undefined);
          }}
        />
      ) : (
        <Button
          label={t('session.dispute.raise')}
          variant="secondary"
          layout="block"
          onPress={() => setOpen(true)}
        />
      )}
    </View>
  );
}
