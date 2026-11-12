// T043 of specs/004-sessions (FR-463 to FR-466, FR-494; R-MOBILE-12; R-320): the student's remedy
// on the session's screen, composed by the student's session wrapper in the screen's one slot (the
// note under T041, Q1 (a)). It reads the session through `sessions.get` (the screen's own read, from
// the cache) and draws what `remedy.ts` says of it: the proposal and the choice window's close, a
// pending counter-proposal and its answer window's close, each in its own zone and the viewer's
// (`ZoneLines`), then the actions the remedy offers, each opening its sheet. Nothing for a session
// with no remedy, nor for a status the parties never see.
import type { RemedyView, SessionsGetOutput } from '@ijazah/contracts';
import { useState } from 'react';

import { Button, Card, List, ListRow, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useSessionRead } from '../../../shared/room';
import { ZoneLines } from '../../../shared/room/components/ZoneLines';
import { type StudentRemedyShown, studentRemedyShown } from '../remedy';
import { AcceptSheet } from './AcceptSheet';
import { CounterSheet } from './CounterSheet';
import { RefundSheet } from './RefundSheet';

export function StudentRemedyPanel({ sessionId }: { readonly sessionId: string }) {
  const session = useSessionRead(sessionId).data;
  const viewerZone = useMe().data?.timezone;
  const remedy = session?.remedy;
  if (session === undefined || remedy === undefined || viewerZone === undefined) return null;
  const shown = studentRemedyShown(remedy);
  if (shown === undefined) return null;
  return <Panel session={session} remedy={remedy} shown={shown} viewerZone={viewerZone} />;
}

type Opened = 'accept' | 'counter' | 'refund';

function Panel({
  session,
  remedy,
  shown,
  viewerZone,
}: {
  readonly session: SessionsGetOutput;
  readonly remedy: RemedyView;
  readonly shown: StudentRemedyShown;
  readonly viewerZone: string;
}) {
  const t = useT();
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = () => setOpened(null);
  const { proposal, counter } = remedy;
  return (
    <Card variant="surface">
      <Text variant="headline">{t('student.remedy.title')}</Text>
      <Text tone="muted">{t(shown.text)}</Text>
      {shown.open ? (
        <List>
          {proposal === undefined ? null : (
            <ListRow
              label={t('student.remedy.proposal')}
              value={
                <ZoneLines
                  instant={proposal.startsAt}
                  sessionZone={proposal.timezone}
                  viewerZone={viewerZone}
                />
              }
            />
          )}
          <ListRow
            label={t('student.remedy.choiceClosesAt')}
            value={
              <ZoneLines
                instant={remedy.choiceClosesAt}
                sessionZone={session.timezone}
                viewerZone={viewerZone}
              />
            }
          />
          {shown.counterPending && counter !== undefined ? (
            <ListRow
              label={t('student.remedy.counter')}
              value={
                <ZoneLines
                  instant={counter.startsAt}
                  sessionZone={counter.timezone}
                  viewerZone={viewerZone}
                />
              }
            />
          ) : null}
          {shown.counterPending && counter !== undefined ? (
            <ListRow
              label={t('student.remedy.answerClosesAt')}
              value={
                <ZoneLines
                  instant={counter.answerClosesAt}
                  sessionZone={session.timezone}
                  viewerZone={viewerZone}
                />
              }
            />
          ) : null}
        </List>
      ) : null}
      {shown.canAccept ? (
        <Button
          label={t('student.remedy.accept')}
          layout="block"
          onPress={() => setOpened('accept')}
        />
      ) : null}
      {shown.canCounter ? (
        <Button
          label={t('student.remedy.proposeOther')}
          variant="secondary"
          layout="block"
          onPress={() => setOpened('counter')}
        />
      ) : null}
      {shown.canRefund ? (
        <Button
          label={t('student.remedy.refund')}
          variant="ghost"
          layout="block"
          onPress={() => setOpened('refund')}
        />
      ) : null}
      {opened === 'accept' && proposal !== undefined ? (
        <AcceptSheet
          session={session}
          proposal={proposal}
          withdrawsCounter={shown.counterPending}
          viewerZone={viewerZone}
          onClose={close}
        />
      ) : null}
      {opened === 'counter' ? (
        <CounterSheet session={session} viewerZone={viewerZone} onClose={close} />
      ) : null}
      {opened === 'refund' ? <RefundSheet session={session} onClose={close} /> : null}
    </Card>
  );
}
