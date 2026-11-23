// T019 of specs/004-sessions (FR-433, FR-435, FR-436, FR-500; US1 acceptance 5 and 6; research
// R-316; screens.md `SessionRoom`, `SessionWaiting`, `SessionReconnecting`): the room, the same for
// both roles but for whose stand-in a deleted counterparty takes (each role's
// `features/*/sessions/`). It draws what the connection holds (`connection.ts`): the counterparty's
// screen when they share it, else their camera, else their name, or that they have not joined yet;
// the participant's own camera when it is on; the controls of the camera, the screen share (FR-500's
// warning first, every time) and leaving; and the states around them: joining, the connection being
// rejoined, when joining opens, a session that cannot be joined, the session's end. Audio needs no
// control: it is on in every session (FR-433).
//
// B40a, T019's follow-up (a): leaving by the system's back is held (`usePreventRemove`) until the
// connection is closed and the audio session stopped, as the header's back is, so the old room's
// `stopAudio` never lands after a next room's `startAudio`; either back leaves once. T065: the
// first join's failure says when to try again after `RATE_LIMITED` (`genericErrorKey`). 004:T084
// (NFR-SEC-13, R-HONEST; DEC-107, round 2): a phone that could not encrypt is told the session could
// not connect; the counterparty's tracks that are not encrypted, or cannot be decrypted, are said to
// be unavailable. No word on the screen names the encryption; the Administration alone sees it.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { type TrackReference, VideoTrack } from '@livekit/react-native';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { type ReactNode, useRef, useState } from 'react';
import { View } from 'react-native';

import {
  Avatar,
  Banner,
  Button,
  Card,
  Dialog,
  NavHeader,
  Spinner,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { genericErrorKey } from '../../../../lib/error-message';
import { avatarNameOf, type PartyRole, usePartyName } from '../../../../lib/party';
import { initialsOf } from '../../account';
import { ReportEntry } from '../../reports';
import { StackScreen } from '../../screen';
import { useSessionRead } from '../api';
import { ZoneLines } from '../components/ZoneLines';
import type { RoomView } from '../connection';
import { type RoomControls, useRoom } from '../use-room';

/** The route's `id`, or '' when the link carries none. */
function useSessionParam(): string {
  const params = useLocalSearchParams<{ id: string }>();
  return typeof params.id === 'string' ? params.id : '';
}

export function RoomScreen({ counterpartyRole }: { readonly counterpartyRole: PartyRole }) {
  const t = useT();
  const sessionId = useSessionParam();
  const read = useSessionRead(sessionId);
  const me = useMe();
  const session = read.data;
  const room = useRoom(sessionId, session?.endsAt);
  const partyName = usePartyName();
  const party =
    session === undefined
      ? undefined
      : {
          displayNameOrNull: session.counterparty.displayName,
          deleted: session.counterparty.deleted,
        };
  const name = party === undefined ? '' : partyName(party, counterpartyRole);
  const leaving = useRef(false);
  const [left, setLeft] = useState(false);
  // The system's back waits for the room to be left, then goes on (follow-up (a)).
  const allowRemoval = usePreventRemove(!left, ({ repeat }) => leave(repeat));
  /** Leaves once, whichever back came first, then goes back. */
  function leave(goBack: () => void = () => router.back()) {
    if (leaving.current) return;
    leaving.current = true;
    void room.leave().then(() => {
      setLeft(true);
      allowRemoval();
      goBack();
    });
  }
  // 005:T021, E1 (a) (FR-611): the same report entry as the pre-session screen's, from inside the room.
  const trailing =
    session === undefined ? undefined : (
      <ReportEntry
        target={{
          userId: session.counterparty.userId,
          role: counterpartyRole,
          name,
          place: { context: 'session', sessionId: session.sessionId },
        }}
      />
    );
  const header = (
    <NavHeader title={name} back={{ kind: 'back', onPress: () => leave() }} trailing={trailing} />
  );
  return (
    <StackScreen header={header}>
      <Body
        room={room}
        session={session}
        viewerZone={me.data?.timezone}
        name={name}
        avatar={party === undefined ? '' : initialsOf(avatarNameOf(party))}
        onLeave={() => leave()}
      />
      <Dialog
        open={room.view?.shareWarningOpen ?? false}
        title={t('session.room.screenShare.title')}
        actions={[
          { label: t('common.action.continue'), variant: 'primary', onPress: room.confirmShare },
          { label: t('common.action.cancel'), variant: 'secondary', onPress: room.cancelShare },
        ]}
      >
        {t('session.room.screenShare.warning')}
      </Dialog>
    </StackScreen>
  );
}

function Body({
  room,
  session,
  viewerZone,
  name,
  avatar,
  onLeave,
}: {
  readonly room: RoomControls;
  readonly session: SessionsGetOutput | undefined;
  readonly viewerZone: string | undefined;
  readonly name: string;
  readonly avatar: string;
  readonly onLeave: () => void;
}) {
  const t = useT();
  const { phase, view } = room;
  switch (phase.kind) {
    case 'connecting':
      return (
        <View style={{ alignItems: 'center', gap: tokens.space['3'] }}>
          <Spinner />
          <Text tone="muted">{t('session.room.connecting')}</Text>
        </View>
      );
    case 'notOpen':
      return (
        <View style={{ gap: tokens.space['2'] }}>
          <Text>{t('session.pre.opensAt')}</Text>
          {phase.opensAt === undefined ||
          session === undefined ||
          viewerZone === undefined ? null : (
            <ZoneLines
              instant={phase.opensAt}
              sessionZone={session.timezone}
              viewerZone={viewerZone}
            />
          )}
        </View>
      );
    case 'refused':
      return <Text tone="muted">{t('session.pre.unavailable')}</Text>;
    case 'ended':
      return <Text tone="muted">{t('session.room.ended')}</Text>;
    case 'encryptionFailed':
      return (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t('session.room.connectFailed')}
        </Banner>
      );
    case 'anotherDevice':
      return (
        <View style={{ gap: tokens.space['3'] }}>
          <Text>{t('session.room.anotherDevice.message')}</Text>
          <Button
            label={t('session.room.anotherDevice.action')}
            variant="primary"
            onPress={room.takeBack}
          />
        </View>
      );
    case 'failed': {
      const message = genericErrorKey(phase.error, 'common.state.actionError');
      return (
        <View style={{ gap: tokens.space['3'] }}>
          <Banner icon={{ name: 'triangle-alert' }} tone="danger">
            {t(message.key, message.values)}
          </Banner>
          <Button label={t('common.action.retry')} variant="secondary" onPress={room.retry} />
        </View>
      );
    }
    case 'connected':
    case 'reconnecting':
      return (
        <View style={{ gap: tokens.space['4'] }}>
          {phase.kind === 'reconnecting' ? (
            <Banner icon={{ name: 'wifi-off' }} tone="warning">
              {t('session.room.reconnecting')}
            </Banner>
          ) : null}
          <Counterparty view={view} name={name} avatar={avatar} />
          <Self view={view} />
          <Controls room={room} connected={phase.kind === 'connected'} onLeave={onLeave} />
        </View>
      );
  }
}

function Tile({ children }: { readonly children: ReactNode }) {
  return (
    <Card variant="surface">
      <View style={{ minHeight: tokens.size['list-row'], justifyContent: 'center' }}>
        {children}
      </View>
    </Card>
  );
}

function Video({
  track,
  mirror = false,
}: {
  readonly track: TrackReference;
  readonly mirror?: boolean;
}) {
  return (
    <View style={{ aspectRatio: 4 / 3, overflow: 'hidden', borderRadius: tokens.radius.lg }}>
      <VideoTrack
        trackRef={track}
        mirror={mirror}
        objectFit={track.source === 'screen_share' ? 'contain' : 'cover'}
        style={{ flex: 1 }}
      />
    </View>
  );
}

function Counterparty({
  view,
  name,
  avatar,
}: {
  readonly view: RoomView | undefined;
  readonly name: string;
  readonly avatar: string;
}) {
  const t = useT();
  const shown = view?.counterpartyScreen ?? view?.counterpartyCamera;
  if (shown !== undefined) {
    return (
      <Tile>
        <Video track={shown} />
        <Text variant="callout">{name}</Text>
        <CounterpartyEncryption view={view} />
      </Tile>
    );
  }
  return (
    <Tile>
      <View style={{ alignItems: 'center', gap: tokens.space['2'] }}>
        <Avatar initials={avatar} size="xl" />
        {view?.counterpartyPresent === true ? (
          <Text variant="headline">{name}</Text>
        ) : (
          <Text tone="muted">{t('session.room.waitingFor', { name })}</Text>
        )}
        <CounterpartyEncryption view={view} />
      </View>
    </Tile>
  );
}

/**
 * 004:T084 (R-HONEST, DEC-107): the counterparty's audio and video, not played because a track came
 * unencrypted or cannot be decrypted, said to be unavailable, in words that do not name the cause.
 */
function CounterpartyEncryption({ view }: { readonly view: RoomView | undefined }) {
  const t = useT();
  const unavailable =
    view?.counterpartyUnencrypted === true || view?.counterpartyUndecryptable === true;
  return unavailable ? (
    <Text variant="caption" tone="danger">
      {t('session.room.counterpartyUnavailable')}
    </Text>
  ) : null;
}

function Self({ view }: { readonly view: RoomView | undefined }) {
  const t = useT();
  return (
    <Tile>
      {view?.ownCamera === undefined ? (
        <View style={{ gap: tokens.space['1'] }}>
          <Text variant="headline">{t('session.room.you')}</Text>
          <Text variant="caption" tone="muted">
            {t('session.room.audioOnCameraOff')}
          </Text>
        </View>
      ) : (
        <Video track={view.ownCamera} mirror />
      )}
      {view?.sharing === true ? (
        <Text variant="caption" tone="muted">
          {t('session.room.sharing')}
        </Text>
      ) : null}
      {view?.cameraRefused === true ? (
        <Text variant="caption" tone="danger">
          {t('session.room.cameraDenied')}
        </Text>
      ) : null}
      {view?.deviceFailed === true ? (
        <Text variant="caption" tone="danger">
          {t('common.state.actionError')}
        </Text>
      ) : null}
    </Tile>
  );
}

function Controls({
  room,
  connected,
  onLeave,
}: {
  readonly room: RoomControls;
  readonly connected: boolean;
  readonly onLeave: () => void;
}) {
  const t = useT();
  const cameraOn = room.view?.cameraOn === true;
  const sharing = room.view?.sharing === true;
  const busy = room.view?.startingShare === true || room.view?.stoppingShare === true;
  return (
    <View style={{ gap: tokens.space['2'] }}>
      <Button
        label={t(cameraOn ? 'session.room.cameraOff' : 'session.room.cameraOn')}
        variant="secondary"
        layout="block"
        icon={{ name: cameraOn ? 'video-off' : 'video' }}
        disabled={!connected}
        onPress={room.toggleCamera}
      />
      <Button
        label={t(sharing ? 'session.room.stopShare' : 'session.room.shareScreen')}
        variant="secondary"
        layout="block"
        icon={{ name: 'share' }}
        disabled={!connected || busy}
        onPress={sharing ? room.stopShare : room.askToShare}
      />
      <Button
        label={t('session.room.leave')}
        variant="danger"
        layout="block"
        icon={{ name: 'phone-off' }}
        onPress={onLeave}
      />
    </View>
  );
}
