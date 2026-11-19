// T048 (FR-477, FR-439; T033, T059; research R-323 GAP-2 and GAP-3): a session's connection record
// beside the queue, at `/review?session=`, for any session no longer scheduled (`sessions.review.get`,
// `Telemetry`). It shows the schedule in the session's own zone (its local date and start, R-TIME)
// and in the panel's, every recorded join and leave and the room's end, each party's connected
// intervals and the two together, the simultaneous seconds the evaluation recorded, who joined, and
// the outage windows over it. A scheduled session (`CONFLICT` `not_settled`) and a missing one
// (`NOT_FOUND`) are said in plain words; any other failure is `admin.common.loadError.text`.
//
// Its one action follows the status the server answered, never a rule of the page's own: a session
// under review (`under_threshold`, `provider_outage`) is resolved (`ResolveDialog`); a settled `done`
// or no-show outcome is corrected through the shared `CorrectionDialog`, the server deciding
// whether the correction is admitted. Each dialog is mounted only while it is open; after either,
// the record and the queue are read again.
import { useState } from 'react';

import {
  Badge,
  Banner,
  Button,
  KeyValue,
  List,
  ListRow,
  Panel,
  Skeleton,
  type StatusTone,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { errorMessageKey } from '../../lib/error-message';
import { cityName, dayMonthYear, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { CorrectionDialog } from '../_shared';
import { type Telemetry, useRereadReview, useTelemetry } from './queries';
import { ResolveDialog } from './ResolveDialog';

type SessionStatus = Telemetry['status'];

/** Each status's word and tone, as the queue and the record draw it. */
export const SESSION_STATUS: Readonly<
  Record<SessionStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  scheduled: { label: 'admin.status.session.scheduled', tone: 'neutral' },
  done: { label: 'admin.status.session.done', tone: 'success' },
  student_no_show: { label: 'admin.status.session.studentNoShow', tone: 'warning' },
  teacher_no_show: { label: 'admin.status.session.teacherNoShow', tone: 'warning' },
  both_no_show: { label: 'admin.status.session.bothNoShow', tone: 'warning' },
  under_threshold: { label: 'admin.status.session.underThreshold', tone: 'warning' },
  provider_outage: { label: 'admin.status.session.providerOutage', tone: 'warning' },
  disputed: { label: 'admin.status.session.disputed', tone: 'danger' },
  cancelled_by_agreement: { label: 'admin.status.session.cancelledByAgreement', tone: 'neutral' },
  cancelled_by_admin: { label: 'admin.status.session.cancelledByAdmin', tone: 'neutral' },
  postponed: { label: 'admin.status.session.postponed', tone: 'neutral' },
};

/** The statuses `sessions.review.resolve` settles (R-SESS-6). */
const UNDER_REVIEW: ReadonlySet<SessionStatus> = new Set(['under_threshold', 'provider_outage']);
/** The settled outcomes `sessions.review.revise` corrects (FR-439). */
const CORRECTABLE: ReadonlySet<SessionStatus> = new Set([
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
]);

type Event = Telemetry['events'][number];

function eventWords(event: Event): MessageKey {
  if (event.type === 'room_ended') return 'admin.review.telemetry.events.roomEnded';
  if (event.party === 'teacher') {
    return event.type === 'joined'
      ? 'admin.review.telemetry.events.teacherJoined'
      : 'admin.review.telemetry.events.teacherLeft';
  }
  return event.type === 'joined'
    ? 'admin.review.telemetry.events.studentJoined'
    : 'admin.review.telemetry.events.studentLeft';
}

/** A failed read the task names: a scheduled or missing session, in plain words. */
function readRefusal(error: unknown): MessageKey | undefined {
  const cause = errorDetailsOf(error).find((each) => each.path === 'cause')?.code;
  const code = errorCodeOf(error);
  if (code === 'CONFLICT' && cause === 'not_settled') {
    return 'admin.review.telemetry.refused.notSettled';
  }
  if (code === 'NOT_FOUND') return 'admin.review.telemetry.refused.notFound';
  return undefined;
}

export function TelemetryPanel({ sessionId }: { readonly sessionId: string }) {
  const t = useT();
  const read = useTelemetry(sessionId);
  if (read.data !== undefined) return <TelemetryRecord record={read.data} />;
  if (read.isError) {
    const named = readRefusal(read.error);
    const words =
      named === undefined
        ? errorMessageKey(read.error, 'admin.common.loadError.text')
        : { key: named };
    return (
      <div className="stack gap-4">
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(words.key, words.values)}
        </Banner>
        {named === undefined ? (
          <div className="row">
            <Button
              label={t('admin.common.action.retry')}
              variant="secondary"
              onPress={() => void read.refetch()}
            />
          </div>
        ) : null}
      </div>
    );
  }
  return <Skeleton shape="block" />;
}

function TelemetryRecord({ record }: { readonly record: Telemetry }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const reread = useRereadReview();
  const [open, setOpen] = useState<'resolve' | 'correct' | null>(null);
  const status = SESSION_STATUS[record.status];
  const at = (value: string) => timeOfDay(value, locale, zone);
  const span = (from: string, to: string) =>
    t('admin.review.telemetry.span', { start: at(from), end: at(to) });
  const dated = (from: string, to: string) =>
    t('admin.common.dateTime', { date: dayMonthYear(from, locale, zone), time: span(from, to) });
  const joined = (yes: boolean) =>
    t(yes ? 'admin.review.telemetry.joined' : 'admin.review.telemetry.notJoined');
  const intervals = (
    [
      ['student', 'admin.review.telemetry.intervals.student'],
      ['teacher', 'admin.review.telemetry.intervals.teacher'],
      ['together', 'admin.review.telemetry.intervals.together'],
    ] as const
  ).map(([key, label]) => ({ key, label, spans: record.intervals[key] }));

  const action = UNDER_REVIEW.has(record.status) ? (
    <Button label={t('admin.review.telemetry.resolve')} onPress={() => setOpen('resolve')} />
  ) : CORRECTABLE.has(record.status) ? (
    <Button
      label={t('admin.review.telemetry.correct')}
      variant="secondary"
      onPress={() => setOpen('correct')}
    />
  ) : undefined;

  return (
    <>
      <Panel
        header={
          <span className="row wrap gap-2 grow">
            <strong className="text-title-3 grow">{t('admin.review.telemetry.title')}</strong>
            <Badge label={t(status.label)} tone={status.tone} />
          </span>
        }
        {...(action === undefined ? {} : { actions: action })}
      >
        <KeyValue
          items={[
            {
              label: t('admin.review.telemetry.inSessionZone', {
                city: cityName(record.schedule.timezone, locale),
              }),
              value: t('admin.review.telemetry.sessionStart', {
                date: dayMonthYear(record.schedule.localDate, locale, zone),
                time: record.schedule.startTimeLocal,
              }),
            },
            {
              label: t('admin.review.telemetry.inPanelZone', { city: cityName(zone, locale) }),
              value: dated(record.schedule.startsAt, record.schedule.endsAt),
            },
            {
              label: t('admin.review.telemetry.simultaneous'),
              value: t('admin.review.seconds', { count: record.simultaneousSeconds }),
            },
            {
              label: t('admin.review.telemetry.joinedStudent'),
              value: joined(record.joined.student),
            },
            {
              label: t('admin.review.telemetry.joinedTeacher'),
              value: joined(record.joined.teacher),
            },
          ]}
        />
        <List header={t('admin.review.telemetry.eventsTitle')}>
          {record.events.length === 0 ? (
            <ListRow label={t('admin.review.telemetry.noEvents')} />
          ) : (
            record.events.map((event, index) => (
              <ListRow
                key={`${event.occurredAt}-${String(index)}`}
                label={t(eventWords(event))}
                value={at(event.occurredAt)}
              />
            ))
          )}
        </List>
        <List header={t('admin.review.telemetry.intervalsTitle')}>
          {intervals.map(({ key, label, spans }) => (
            <ListRow
              key={key}
              label={t(label)}
              value={
                spans.length === 0 ? (
                  t('admin.review.telemetry.noInterval')
                ) : (
                  <span className="stack">
                    {spans.map((each) => (
                      <span key={each.startsAt}>{span(each.startsAt, each.endsAt)}</span>
                    ))}
                  </span>
                )
              }
            />
          ))}
        </List>
        <List header={t('admin.review.telemetry.outagesTitle')}>
          {record.outages.length === 0 ? (
            <ListRow label={t('admin.review.telemetry.noOutages')} />
          ) : (
            record.outages.map((each) => (
              <ListRow key={each.outageId} label={dated(each.startsAt, each.endsAt)} />
            ))
          )}
        </List>
      </Panel>
      {open === 'resolve' ? (
        <ResolveDialog sessionId={record.sessionId} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'correct' ? (
        <CorrectionDialog
          sessionId={record.sessionId}
          onDone={() => {
            setOpen(null);
            void reread();
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}
