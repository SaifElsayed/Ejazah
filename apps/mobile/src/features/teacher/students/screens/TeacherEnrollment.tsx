// T051 (FR-391, FR-393, FR-392; screens.md §14): one of the teacher's enrollments, read by
// `teacher.students.get`. The card: the student by initial and name, the package line, the status
// and the track, whose accent badge is the ijazah track's state as far as this phase has data (its
// card and request are Phase 4's); what is done and what is to come, derived by the server; the
// weekly time as the slot holds it, in the sessions' zone with its city, until the last session, or
// from the first to the last once ended; and when the teacher's zone is now another, the next
// session there (ADR 0009 D5). Then the sessions by number (`session-rows.ts`), keyed by their id,
// each with its status after settlement (004:T020, FR-495): a disputed session reads «محل نزاع»,
// the outcome frozen beside it never answered nor drawn (R-308); a session with a pending
// cancellation request says so on its own row (004:T041, FR-495). It decides only on
// what it read since it opened (`read-since-mount.ts`). A link with no enrollment id is never read:
// it draws the load error, as the student's detail does, and its retry sends nothing (T091).
// Phase 3's parts are not drawn: the report, the no-show tile and banner, the chat, the
// cancellation and every session's sub-line. 004:T044 (FR-495): a session owing a remedy says where
// it stands under its row (`TeacherRemedyStatusLine`), the row its own (`session-rows.ts`).
import type { ListedSession, TeacherStudentsGetOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import {
  Avatar,
  Card,
  List,
  ListRow,
  NavHeader,
  Section,
  Stats,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters, weekdayIn } from '../../../../lib/formatters';
import { useOnline } from '../../../../lib/online';
import { avatarNameOf, usePartyName } from '../../../../lib/party';
import { useSubjectName } from '../../../../lib/subjects';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { readSinceMount } from '../../read-since-mount';
import { TeacherRemedyStatusLine } from '../../sessions';
import { TEACHER_PRE_SESSION_ROUTE } from '../../sessions/api';
import { isEnrollmentId, useTeacherEnrollment } from '../api';
import { EnrollmentBadges, SessionStatusBadge } from '../components/Badges';
import { initialOf } from '../components/StudentRow';
import { type SessionRow, sessionRows } from '../session-rows';
import { useInViewerZone } from '../zone';

export function TeacherEnrollment() {
  const t = useT();
  const online = useOnline();
  const params = useLocalSearchParams<{ enrollmentId: string }>();
  const enrollmentId = typeof params.enrollmentId === 'string' ? params.enrollmentId : '';
  const valid = isEnrollmentId(enrollmentId);
  const query = useTeacherEnrollment(enrollmentId);
  const read = readSinceMount(query);
  const retry = () => {
    if (valid) void query.refetch();
  };
  const offlineCached = read.state === 'waiting' && !online ? read.cached : undefined;
  const enrollment = read.state === 'read' ? read.data : offlineCached;
  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.enrollment.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
    >
      {offlineCached === undefined ? null : <OfflineNotice onRetry={retry} />}
      {enrollment === undefined ? (
        <NotLoaded failed={!valid || read.state === 'failed'} error={query.error} onRetry={retry} />
      ) : (
        <EnrollmentBody enrollment={enrollment} />
      )}
    </StackScreen>
  );
}

function EnrollmentBody({ enrollment }: { readonly enrollment: TeacherStudentsGetOutput }) {
  const t = useT();
  const nameOf = useSubjectName();
  const format = useFormatters();
  const partyName = usePartyName();
  const rows = sessionRows(enrollment.sessions, enrollment.next?.sequenceNumber);
  return (
    <>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
          <Avatar initials={initialOf(avatarNameOf(enrollment.student))} size="lg" />
          <View style={{ flex: 1, minWidth: 0, gap: tokens.space['1'] }}>
            <Text variant="headline">{partyName(enrollment.student, 'student')}</Text>
            <Text variant="caption" tone="muted">
              {t('common.package.full', {
                subject: nameOf(enrollment.summary.subject),
                sessions: enrollment.summary.sessionCount,
                minutes: enrollment.summary.sessionDurationMinutes,
              })}
            </Text>
          </View>
          <EnrollmentBadges status={enrollment.status} track={enrollment.summary.track} />
        </View>
        <Stats
          tile
          items={[
            {
              value: format.number(enrollment.completed),
              label: t('teacher.enrollment.stats.done'),
            },
            {
              value: format.number(enrollment.upcoming),
              label: t('teacher.enrollment.stats.upcoming'),
            },
          ]}
        />
        <Schedule enrollment={enrollment} />
      </Card>
      {rows.length === 0 ? null : (
        <Section title={t('teacher.enrollment.sessions.title')}>
          <List>
            {rows.map((row) => (
              <SessionLine
                key={row.kind === 'one' ? row.session.sessionId : row.first.sessionId}
                row={row}
              />
            ))}
          </List>
        </Section>
      )}
    </>
  );
}

/**
 * «كل {day} {time} ({city}) · حتى {date}» while it runs, «كان كل {day} {time} · من … إلى …» once
 * ended: the slot's weekday and wall-clock time in the sessions' zone. Under it, when the teacher's
 * zone is now another, the next session there.
 */
function Schedule({ enrollment }: { readonly enrollment: TeacherStudentsGetOutput }) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const inViewerZone = useInViewerZone();
  const viewerZone = useMe().data?.timezone;
  const first = enrollment.sessions[0];
  const last = enrollment.sessions[enrollment.sessions.length - 1];
  if (first === undefined || last === undefined) return null;
  const day = format.weekday(weekdayIn(first.startsAt, first.timezone));
  const time = format.wallClock(first.startTimeLocal);
  const endDate = format.date(last.startsAt, last.timezone);
  const line =
    enrollment.status === 'confirmed'
      ? t('teacher.enrollment.schedule', {
          day,
          time,
          city: cityOf(first.timezone, locale) ?? first.timezone,
          endDate,
        })
      : t('teacher.enrollment.scheduleEnded', {
          day,
          time,
          startDate: format.date(first.startsAt, first.timezone),
          endDate,
        });
  const shownElsewhere: ListedSession = enrollment.next ?? last;
  const elsewhere = inViewerZone(shownElsewhere.startsAt, shownElsewhere.timezone, viewerZone);
  return (
    <View style={{ gap: tokens.space['1'] }}>
      <Text variant="callout">{line}</Text>
      {elsewhere === null ? null : (
        <Text variant="caption" tone="muted">
          {elsewhere}
        </Text>
      )}
    </View>
  );
}

/** One session «{n} · {date}», the next in bold, or a range «{from} إلى {to} · من … إلى …». */
function SessionLine({ row }: { readonly row: SessionRow }) {
  const t = useT();
  const format = useFormatters();
  if (row.kind === 'range') {
    return (
      <ListRow
        label={
          <Text variant="callout" weight="medium">
            {t('teacher.enrollment.sessions.range', {
              from: row.first.sequenceNumber,
              to: row.last.sequenceNumber,
              startDate: format.date(row.first.startsAt, row.first.timezone),
              endDate: format.date(row.last.startsAt, row.last.timezone),
            })}
          </Text>
        }
        trailing={<SessionStatusBadge status={row.status} />}
      />
    );
  }
  const { session } = row;
  const line = (
    <Text variant="callout" weight={row.next ? 'bold' : 'medium'}>
      {t('teacher.enrollment.sessions.row', {
        n: session.sequenceNumber,
        date: format.weekdayDate(session.startsAt, session.timezone),
      })}
    </Text>
  );
  return (
    <ListRow
      label={
        <View style={{ gap: tokens.space['1'] }}>
          {line}
          {session.pendingCancellation ? (
            <Text variant="caption" tone="warning">
              {t('session.cancellation.row.pending')}
            </Text>
          ) : null}
          <TeacherRemedyStatusLine status={session.remedyStatus} />
        </View>
      }
      trailing={<SessionStatusBadge status={session.status} />}
      onPress={() =>
        router.push({ pathname: TEACHER_PRE_SESSION_ROUTE, params: { id: session.sessionId } })
      }
    />
  );
}
