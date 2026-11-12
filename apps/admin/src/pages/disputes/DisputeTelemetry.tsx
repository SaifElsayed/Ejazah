// T049 (FR-475, FR-SESS-9; T033's `Telemetry`): the session's attendance record on the dispute's
// page, every time in the session's own zone (named once): the schedule, the session's status, the
// accumulated simultaneous time the evaluation decided on, who joined, every recorded join and leave
// and the room's end, oldest first, and the provider outages recorded over it.
import type { Telemetry } from '@ijazah/contracts/admin';

import { KeyValue } from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { cityName, dayMonthYear, timeOfDay } from '../../lib/format';
import { SESSION_STATUS } from './labels';

type TelemetryEvent = Telemetry['events'][number];

/** The words of one recorded event, by its party and its type. */
function eventWords(event: TelemetryEvent): MessageKey {
  if (event.type === 'room_ended') return 'admin.disputes.telemetry.roomEnded';
  if (event.party === 'teacher') {
    return event.type === 'joined'
      ? 'admin.disputes.detail.events.teacherJoined'
      : 'admin.disputes.telemetry.teacherLeft';
  }
  return event.type === 'joined'
    ? 'admin.disputes.detail.events.studentJoined'
    : 'admin.disputes.telemetry.studentLeft';
}

/** Seconds as minutes and seconds, «38:10». */
function minutesAndSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function DisputeTelemetry({ telemetry }: { readonly telemetry: Telemetry }) {
  const t = useT();
  const locale = useLocale();
  const zone = telemetry.schedule.timezone;
  const at = (value: string) => timeOfDay(value, locale, zone);
  const city = cityName(zone, locale);
  return (
    <section className="section">
      <h2 className="group-label">{t('admin.disputes.detail.attendance')}</h2>
      <p className="text-caption tone-muted">{t('admin.disputes.telemetry.zoneNote', { city })}</p>
      <KeyValue
        items={[
          {
            label: t('admin.disputes.telemetry.schedule'),
            value: t('admin.disputes.telemetry.scheduleValue', {
              date: dayMonthYear(telemetry.schedule.localDate, locale, zone),
              time: at(telemetry.schedule.startsAt),
              city,
            }),
          },
          {
            label: t('admin.disputes.detail.sessionStatus'),
            value: t(SESSION_STATUS[telemetry.status]),
          },
          {
            label: t('admin.disputes.telemetry.together'),
            value: t('admin.disputes.telemetry.togetherValue', {
              duration: minutesAndSeconds(telemetry.simultaneousSeconds),
            }),
          },
          {
            label: t('admin.disputes.telemetry.joined'),
            value: (
              <span className="stack gap-half">
                <span>
                  {t(
                    telemetry.joined.student
                      ? 'admin.disputes.detail.events.studentJoined'
                      : 'admin.disputes.telemetry.studentNotJoined',
                  )}
                </span>
                <span>
                  {t(
                    telemetry.joined.teacher
                      ? 'admin.disputes.detail.events.teacherJoined'
                      : 'admin.disputes.telemetry.teacherNotJoined',
                  )}
                </span>
              </span>
            ),
          },
        ]}
      />
      <h3 className="group-label">{t('admin.disputes.detail.a11yEvents')}</h3>
      {telemetry.events.length === 0 ? (
        <p className="text-callout">{t('admin.disputes.telemetry.eventsNone')}</p>
      ) : (
        <ul className="stack gap-2">
          {telemetry.events.map((event) => (
            <li
              key={`${event.occurredAt}-${event.party}-${event.type}`}
              className="row gap-2 text-callout"
            >
              <span>{t(eventWords(event))}</span>
              <span className="tone-muted">{at(event.occurredAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {telemetry.outages.length === 0 ? null : (
        <>
          <h3 className="group-label">{t('admin.disputes.telemetry.outagesTitle')}</h3>
          <ul className="stack gap-2">
            {telemetry.outages.map((outage) => (
              <li key={outage.outageId} className="text-callout">
                {t('admin.disputes.telemetry.outage', {
                  from: at(outage.startsAt),
                  to: at(outage.endsAt),
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
