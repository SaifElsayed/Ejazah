// T018 of specs/004-sessions (FR-434, FR-494, FR-499; US1 acceptance 1 and 4; ADR 0009 D5;
// screens.md `PreSession`, `PreSessionPermission`, `TeacherPreSession`): the screen before the room,
// the same for both roles but for whose stand-in a deleted counterparty takes and which room it
// opens (each role's `features/*/sessions/`). From `sessions.get`: the counterparty's name, the
// scheduled length, the start in the session's zone and in the viewer's; before the lead, when
// joining opens, in both zones; the microphone granted here, and the system settings when it was
// refused for good; the camera off, turned on only in the room (T019). The join waits for the
// period and the microphone (`pre-session.ts`).
//
// T065 (FR-427; research R-324, item 6): «انضمّ الطرف الآخر» while `sessions.get`'s
// `counterpartyInRoom` says the counterparty is in the room, recorded from the provider's
// webhooks; a hint, never a decision: the join waits as before.
//
// B41 (the note under 004:T041, Q1 (a)): one role-neutral slot, `children`, drawn after the rows
// once the session is read; each role's wrapper fills it with its own panels.
//
// 005:T021 (FR-611, FR-614; the note under T021, Q-T4 (a)): once the session is read, the header's
// «إبلاغ» opens the report and flag sheet on the counterparty `sessions.get` names
// (`counterparty.userId`), from this session, for both roles.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  List,
  ListRow,
  NavHeader,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { errorCodeOf } from '../../../../lib/client';
import { avatarNameOf, type PartyRole, usePartyName } from '../../../../lib/party';
import { initialsOf } from '../../account';
import { ReportEntry } from '../../reports';
import { StackScreen } from '../../screen';
import { NotLoaded } from '../../states';
import { useSessionRead } from '../api';
import { ZoneLines } from '../components/ZoneLines';
import { type PreSession, SESSION_STATUS_LABEL, usePreSession } from '../pre-session';

/** The route's `id`, or '' when the link carries none. */
function useSessionParam(): string {
  const params = useLocalSearchParams<{ id: string }>();
  return typeof params.id === 'string' ? params.id : '';
}

export function PreSessionScreen({
  counterpartyRole,
  roomRoute,
  children,
}: {
  /** Whose stand-in a deleted counterparty takes: the student meets a teacher, and the reverse. */
  readonly counterpartyRole: PartyRole;
  /** The role's room route, opened with the session's id. */
  readonly roomRoute: string;
  /** The role's panels, drawn after the rows once the session is read (B41, Q1 (a)). */
  readonly children?: ReactNode;
}) {
  const t = useT();
  const sessionId = useSessionParam();
  const read = useSessionRead(sessionId);
  const me = useMe();
  const header = <Header />;
  const zone = me.data?.timezone;
  if (read.data === undefined || zone === undefined) {
    const notFound = sessionId === '' || errorCodeOf(read.error) === 'NOT_FOUND';
    return (
      <StackScreen header={header}>
        {notFound ? (
          <Text tone="muted">{t('session.pre.unavailable')}</Text>
        ) : (
          <NotLoaded
            failed={read.isError || me.isError}
            error={read.error ?? me.error}
            onRetry={() => {
              if (read.isError) void read.refetch();
              if (me.isError) void me.refetch();
            }}
          />
        )}
      </StackScreen>
    );
  }
  return (
    <Loaded
      session={read.data}
      viewerZone={zone}
      counterpartyRole={counterpartyRole}
      roomRoute={roomRoute}
    >
      {children}
    </Loaded>
  );
}

/** The screen's header; the report's entry once the session is read (005:T021). */
function Header({ trailing }: { readonly trailing?: ReactNode }) {
  const t = useT();
  return (
    <NavHeader
      title={t('session.pre.title')}
      back={{ kind: 'back', onPress: () => router.back() }}
      {...(trailing === undefined ? {} : { trailing })}
    />
  );
}

function Loaded({
  session,
  viewerZone,
  counterpartyRole,
  roomRoute,
  children,
}: {
  readonly session: SessionsGetOutput;
  readonly viewerZone: string;
  readonly counterpartyRole: PartyRole;
  readonly roomRoute: string;
  readonly children?: ReactNode;
}) {
  const t = useT();
  const partyName = usePartyName();
  const state = usePreSession(session);
  const party = {
    displayNameOrNull: session.counterparty.displayName,
    deleted: session.counterparty.deleted,
  };
  const header = (
    <Header
      trailing={
        <ReportEntry
          target={{
            userId: session.counterparty.userId,
            role: counterpartyRole,
            name: partyName(party, counterpartyRole),
            place: { context: 'session', sessionId: session.sessionId },
          }}
        />
      }
    />
  );
  const footer = (
    <View style={{ paddingHorizontal: tokens.layout.gutter, paddingBottom: tokens.space['4'] }}>
      <Button
        label={t('session.pre.join')}
        layout="block"
        disabled={!state.canJoin}
        onPress={() => router.push({ pathname: roomRoute, params: { id: session.sessionId } })}
      />
    </View>
  );
  return (
    <StackScreen header={header} footer={footer}>
      <Card variant="surface">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
          <Avatar initials={initialsOf(avatarNameOf(party))} size="lg" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="headline">{partyName(party, counterpartyRole)}</Text>
            {session.counterpartyInRoom ? (
              <Badge label={t('session.pre.counterpartyInRoom')} tone="success" />
            ) : null}
          </View>
        </View>
      </Card>
      {state.unavailable ? (
        <View style={{ gap: tokens.space['2'] }}>
          {session.status === 'scheduled' ? null : (
            <Text tone="muted">{t(SESSION_STATUS_LABEL[session.status])}</Text>
          )}
          <Text tone="muted">{t('session.pre.unavailable')}</Text>
        </View>
      ) : null}
      {state.microphone.access === 'blocked' ? (
        <Banner icon={{ name: 'mic-off' }} tone="danger">
          {t('session.pre.permission.banner')}
        </Banner>
      ) : null}
      <List>
        <ListRow
          label={t('session.pre.duration')}
          value={t('common.format.duration', { minutes: session.lengthMinutes })}
        />
        <ListRow
          label={t('session.pre.startsAt')}
          value={
            <ZoneLines
              instant={session.startsAt}
              sessionZone={session.timezone}
              viewerZone={viewerZone}
            />
          }
        />
        {state.window === 'before' ? (
          <ListRow
            label={t('session.pre.opensAt')}
            value={
              <ZoneLines
                instant={session.join.opensAt}
                sessionZone={session.timezone}
                viewerZone={viewerZone}
              />
            }
          />
        ) : null}
        <MicrophoneRow state={state} />
        <ListRow
          label={
            <DeviceLabel name={t('session.pre.camera')} note={t('session.pre.cameraOptional')} />
          }
          value={
            <View style={{ alignItems: 'flex-end', gap: tokens.space['1'] }}>
              <Badge label={t('session.pre.cameraStatus.off')} tone="neutral" />
              <Text variant="caption" tone="muted">
                {t('session.pre.cameraInRoom')}
              </Text>
            </View>
          }
        />
      </List>
      {children}
    </StackScreen>
  );
}

function DeviceLabel({ name, note }: { readonly name: string; readonly note: string }) {
  return (
    <View style={{ gap: tokens.space['1'] }}>
      <Text>{name}</Text>
      <Text variant="caption" tone="muted">
        {note}
      </Text>
    </View>
  );
}

function MicrophoneRow({ state }: { readonly state: PreSession }) {
  const t = useT();
  const { access, ask, openSettings } = state.microphone;
  const value =
    access === 'granted' ? (
      <Badge label={t('session.pre.micStatus.working')} tone="success" />
    ) : access === 'blocked' ? (
      <View style={{ alignItems: 'flex-end', gap: tokens.space['2'] }}>
        <Badge label={t('session.pre.micStatus.denied')} tone="danger" />
        <Button
          label={t('session.pre.permission.openSettings')}
          variant="secondary"
          size="md"
          icon={{ name: 'sliders-horizontal' }}
          onPress={openSettings}
        />
      </View>
    ) : access === undefined ? undefined : (
      <View style={{ alignItems: 'flex-end', gap: tokens.space['2'] }}>
        {access === 'denied' ? (
          <Badge label={t('session.pre.micStatus.denied')} tone="danger" />
        ) : null}
        <Button
          label={t('session.pre.allowMic')}
          variant="secondary"
          size="md"
          icon={{ name: 'mic' }}
          onPress={() => void ask()}
        />
      </View>
    );
  return (
    <ListRow
      label={<DeviceLabel name={t('session.pre.mic')} note={t('session.pre.micRequired')} />}
      value={value}
    />
  );
}
