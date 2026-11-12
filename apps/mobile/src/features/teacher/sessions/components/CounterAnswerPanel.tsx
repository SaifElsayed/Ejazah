// T044 of specs/004-sessions (FR-465, FR-494; R-MOBILE-12; R-320): the teacher's answer to a
// counter-proposal, a teacher-only panel composed by the teacher's session wrapper in the screen's
// one slot (the note under T041, Q1 (a)). It reads the session through `sessions.get` (the screen's
// own read, from the cache) and, while a counter-proposal is pending (`counter-answer.ts`), draws
// its time and its answer window's close, each in its own zone and the viewer's (`ZoneLines`), what
// silence does, and accept or decline, the decline's words saying what FR-465 says it does. A
// failure stays said after the session is read again, even once no counter is left to answer.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { useState } from 'react';

import { Banner, Button, Card, List, ListRow, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import type { ErrorMessage } from '../../../../lib/error-message';
import { useSessionRead } from '../../../shared/room';
import { ZoneLines } from '../../../shared/room/components/ZoneLines';
import { answerProblemOf, pendingCounterOf } from '../counter-answer';
import { useAnswerCounter } from '../counter-api';

export function CounterAnswerPanel({ sessionId }: { readonly sessionId: string }) {
  const session = useSessionRead(sessionId).data;
  const viewerZone = useMe().data?.timezone;
  if (session === undefined || viewerZone === undefined) return null;
  return <Answer session={session} viewerZone={viewerZone} />;
}

function Answer({
  session,
  viewerZone,
}: {
  readonly session: SessionsGetOutput;
  readonly viewerZone: string;
}) {
  const t = useT();
  const answer = useAnswerCounter(session);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ErrorMessage | null>(null);
  const counter = pendingCounterOf(session.remedy);

  async function send(accept: boolean): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await answer(accept);
    } catch (caught: unknown) {
      setProblem(answerProblemOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const said =
    problem === null ? null : (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(problem.key, problem.values)}
      </Banner>
    );
  if (counter === undefined) return said;
  return (
    <Card variant="surface">
      <Text variant="headline">{t('teacher.counter.title')}</Text>
      {said}
      <List>
        <ListRow
          label={t('teacher.counter.proposal')}
          value={
            <ZoneLines
              instant={counter.startsAt}
              sessionZone={counter.timezone}
              viewerZone={viewerZone}
            />
          }
        />
        <ListRow
          label={t('teacher.counter.answerClosesAt')}
          value={
            <ZoneLines
              instant={counter.answerClosesAt}
              sessionZone={session.timezone}
              viewerZone={viewerZone}
            />
          }
        />
      </List>
      <Text tone="muted">{t('teacher.counter.text')}</Text>
      <Button
        label={t('teacher.counter.accept')}
        layout="block"
        loading={busy}
        disabled={busy}
        onPress={() => void send(true)}
      />
      <Button
        label={t('teacher.counter.decline')}
        variant="secondary"
        layout="block"
        disabled={busy}
        onPress={() => void send(false)}
      />
      <Text variant="caption" tone="muted">
        {t('teacher.counter.declineNote')}
      </Text>
    </Card>
  );
}
