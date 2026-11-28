// T051 (FR-391, FR-393; screens.md §14): «اليوم», the teacher's tab root, read by `teacher.today`. The
// day's date and line, what is done and what is left today, and the agenda by start; a day without
// sessions is `TeacherHomeEmpty`. It decides only on what it read since it opened
// (`read-since-mount.ts`): before that the shared states (002:T138), a failed read the retry state
// whatever is cached, and with no connection the cached day under the offline banner. The route
// hands it the identity request's card (T074), drawn first.
// R3 (005:T020's follow-up of #148 Saif r1; Q-4′ (b); FR-619, FR-623): the home is the teacher's
// only once approved (`teacher_home`, the server's landing), so each time it opens it asks for
// pushes and registers the device's token (`useAskForPush`; the system answers without a prompt
// once the teacher has decided). No in-app sheet before the system's prompt in v1 (Q-D2).
import type { SessionStatus, TeacherTodayOutput } from '@ijazah/contracts';
import type { ReactNode } from 'react';

import { AppHeader, Card, List, Stats } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { useOnline } from '../../../../lib/online';
import { useAskForPush } from '../../../shared/push';
import { TabScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { readSinceMount } from '../../read-since-mount';
import { useTeacherToday } from '../api';
import { AgendaRow } from '../components/AgendaRow';
import { DayHeading } from '../components/DayHeading';
import { TeacherHomeEmpty } from './TeacherHomeEmpty';

export function TeacherHome({ notice }: { readonly notice?: ReactNode }) {
  const t = useT();
  const online = useOnline();
  const today = useTeacherToday();
  useAskForPush(true);
  const read = readSinceMount(today);
  const retry = () => void today.refetch();
  const offlineCached = read.state === 'waiting' && !online ? read.cached : undefined;
  const day = read.state === 'read' ? read.data : offlineCached;
  const header = <AppHeader title={t('teacher.today.title')} />;

  if (day === undefined) {
    return (
      <TabScreen header={header}>
        {notice}
        <NotLoaded failed={read.state === 'failed'} error={today.error} onRetry={retry} />
      </TabScreen>
    );
  }
  const lead = (
    <>
      {offlineCached === undefined ? null : <OfflineNotice onRetry={retry} />}
      {notice}
    </>
  );
  if (day.sessions.length === 0) return <TeacherHomeEmpty notice={lead} day={day} />;
  return (
    <TabScreen header={header}>
      {lead}
      <DayHeading day={day} />
      <DayStats day={day} />
      <List>
        {day.sessions.map((session) => (
          <AgendaRow
            key={`${session.enrollmentId}:${session.sequenceNumber}`}
            session={session}
            viewerZone={day.timezone}
          />
        ))}
      </List>
    </TabScreen>
  );
}

/** «تمت» and «متبقية اليوم»: the day's sessions done, and those still to come. */
function DayStats({ day }: { readonly day: TeacherTodayOutput }) {
  const t = useT();
  const format = useFormatters();
  const count = (status: SessionStatus) =>
    day.sessions.filter((session) => session.status === status).length;
  return (
    <Card variant="surface">
      <Stats
        items={[
          { value: format.number(count('done')), label: t('teacher.today.stats.done') },
          { value: format.number(count('scheduled')), label: t('teacher.today.stats.remaining') },
        ]}
      />
    </Card>
  );
}
