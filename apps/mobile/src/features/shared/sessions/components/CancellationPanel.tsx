// T041 of specs/004-sessions (FR-456, FR-458, FR-494, FR-495; US3 acceptance 1 to 3; SRS FR-CANCEL-1
// to FR-CANCEL-4): a session's cancellation request on its screen, the same for both roles
// (R-MOBILE-3; the note under T041, Q1 (a)): each role's session wrapper places it in the session
// screen's slot. From `sessions.get`: a pending request with its reason and its expiry at the
// start, in the session's zone and the viewer's (`ZoneLines`); the counterparty accepts or declines
// it; a pending request is shown expired from its expiry by the phone's clock (T065's
// `useCancellationShownExpired`); an answered one says its answer. The request control only while
// `useCancellationRequestShown` says so, with a free-text reason (Q2, Q4). Refusals in the screen's
// words or through `genericErrorKey` (`cancellationRefusal`). The hooks and the server decide; this
// draws.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import type { ErrorMessage } from '../../../../lib/error-message';
import { useSessionRead } from '../../room/api';
import { ZoneLines } from '../../room/components/ZoneLines';
import { type CancellationView, useCancellationShownExpired } from '../cancellation';
import {
  cancellationRefusal,
  useAnswerRequest,
  useCancellationRequestShown,
  useRequestCancellation,
} from '../cancellation-request';
import { ReasonForm } from './ReasonForm';

/** The session's cancellation panel, from `sessions.get` for `sessionId`; nothing until it is read. */
export function CancellationPanel({ sessionId }: { readonly sessionId: string }) {
  const read = useSessionRead(sessionId);
  const viewerZone = useMe().data?.timezone;
  if (read.data === undefined || viewerZone === undefined) return null;
  return <Loaded session={read.data} viewerZone={viewerZone} />;
}

function Loaded({
  session,
  viewerZone,
}: {
  readonly session: SessionsGetOutput;
  readonly viewerZone: string;
}) {
  const requestShown = useCancellationRequestShown(session);
  const { cancellation } = session;
  if (cancellation === undefined && !requestShown) return null;
  return (
    <Card variant="surface">
      {cancellation === undefined ? null : (
        <RequestState session={session} cancellation={cancellation} viewerZone={viewerZone} />
      )}
      {requestShown ? <RequestControl session={session} /> : null}
    </Card>
  );
}

function RequestState({
  session,
  cancellation,
  viewerZone,
}: {
  readonly session: SessionsGetOutput;
  readonly cancellation: CancellationView;
  readonly viewerZone: string;
}) {
  const t = useT();
  const expired = useCancellationShownExpired(cancellation);
  if (expired) return <Text tone="muted">{t('session.cancellation.expired')}</Text>;
  if (cancellation.status === 'accepted') {
    return <Text tone="muted">{t('session.cancellation.accepted')}</Text>;
  }
  if (cancellation.status !== 'pending') {
    return <Text tone="muted">{t('session.cancellation.declined')}</Text>;
  }
  return (
    <View style={{ gap: tokens.space['2'] }}>
      <Text weight="medium">
        {t(
          cancellation.requestedByMe
            ? 'session.cancellation.pending.mine'
            : 'session.cancellation.pending.theirs',
        )}
      </Text>
      <Text tone="muted">{t('session.cancellation.reason', { reason: cancellation.reason })}</Text>
      <View style={{ gap: tokens.space['1'] }}>
        <Text variant="caption">{t('session.cancellation.expiresAt')}</Text>
        <ZoneLines
          instant={cancellation.expiresAt}
          sessionZone={session.timezone}
          viewerZone={viewerZone}
        />
      </View>
      {cancellation.requestedByMe ? null : (
        <Answer session={session} requestId={cancellation.requestId} />
      )}
    </View>
  );
}

function Answer({
  session,
  requestId,
}: {
  readonly session: SessionsGetOutput;
  readonly requestId: string;
}) {
  const t = useT();
  const answers = useAnswerRequest(session);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  async function answer(accept: boolean): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      await answers.answer(requestId, accept);
    } catch (caught: unknown) {
      setFailure(cancellationRefusal(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: tokens.space['2'] }}>
      <Text variant="caption" tone="muted">
        {t('session.cancellation.ifAnswer')}
      </Text>
      {failure === undefined ? null : <Text tone="danger">{t(failure.key, failure.values)}</Text>}
      <View style={{ flexDirection: 'row', gap: tokens.space['2'] }}>
        <Button
          label={t('session.cancellation.accept')}
          layout="grow"
          disabled={busy}
          onPress={() => void answer(true)}
        />
        <Button
          label={t('session.cancellation.decline')}
          variant="secondary"
          layout="grow"
          disabled={busy}
          onPress={() => void answer(false)}
        />
      </View>
    </View>
  );
}

function RequestControl({ session }: { readonly session: SessionsGetOutput }) {
  const t = useT();
  const requests = useRequestCancellation(session);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  if (!open) {
    return (
      <Button
        label={t('session.cancellation.request')}
        variant="secondary"
        layout="block"
        onPress={() => setOpen(true)}
      />
    );
  }
  async function send(text: string): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      if ((await requests.request(text)) !== undefined) setOpen(false);
    } catch (caught: unknown) {
      setFailure(cancellationRefusal(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ReasonForm
      words={{
        label: t('session.cancellation.form.reason'),
        hint: t('session.cancellation.form.hint'),
        send: t('session.cancellation.form.send'),
        back: t('session.cancellation.form.back'),
        tooLong: t('session.cancellation.form.tooLong'),
      }}
      busy={busy}
      failure={failure === undefined ? undefined : t(failure.key, failure.values)}
      onSend={(text) => void send(text)}
      onBack={() => {
        setOpen(false);
        setFailure(undefined);
      }}
    />
  );
}
