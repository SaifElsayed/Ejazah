// T048 (FR-445; T016; R-TIME-6): recording a video outage window. One dialog with the window's two
// ends, each a local date (typed day / month / year, `lib/day-field.ts`) and a local time on the
// 24-hour clock, the zone they are read in (the panel's, `lib/zone.ts`, named by its city through
// `lib/format.ts`), and a mandatory reason; nothing is sent until each is whole, and no instant is
// computed here: the server resolves both ends in the zone with `packages/time`. What follows is
// said as the server does it now. The server's validation refusals are said in place, beside their
// field (an end not after the start, a zone it does not know); any other failure is the generic
// `admin.dialogs.submitError`. The answer goes to `onDone`.
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { calendarDateOfDayField, dayFieldText } from '../../lib/day-field';
import { cityName } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { type RecordInput, useRecordOutage } from './queries';
import { wallClockOf } from './wall-clock';

const WHOLE_DAY = 'DD/MM/YYYY'.length;
/** A typed time long enough to be judged: `H:MM`. */
const JUDGED_TIME = 'H:MM'.length;

type Refused = 'end' | 'zone' | 'other';

/** Where a refused record is said: beside the end, beside the zone, or under the form. */
function refusedAt(error: unknown): Refused {
  if (errorCodeOf(error) !== 'VALIDATION_FAILED') return 'other';
  const details = errorDetailsOf(error);
  if (details.some(({ path, code }) => path === 'end' && code === 'not_after_start')) return 'end';
  if (details.some(({ path, code }) => path === 'timezone' && code === 'unknown')) return 'zone';
  return 'other';
}

export interface RecordedOutage {
  /** The settled sessions the record moved to the review queue. */
  readonly reclassified: number;
}

export function RecordOutageDialog({
  onDone,
  onClose,
}: {
  readonly onDone: (answer: RecordedOutage) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const record = useRecordOutage();
  const [startDay, setStartDay] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDay, setEndDay] = useState('');
  const [endTime, setEndTime] = useState('');
  const [zone, setZone] = useState(panelTimeZone);
  const [reason, setReason] = useState('');
  const [refused, setRefused] = useState<Refused | undefined>(undefined);

  const startDate = calendarDateOfDayField(startDay);
  const endDate = calendarDateOfDayField(endDay);
  const startClock = wallClockOf(startTime);
  const endClock = wallClockOf(endTime);
  const typedZone = zone.trim();
  const input: RecordInput | undefined =
    startDate === undefined ||
    endDate === undefined ||
    startClock === undefined ||
    endClock === undefined ||
    typedZone === '' ||
    reason.trim() === ''
      ? undefined
      : {
          start: { localDate: startDate, localTime: startClock },
          end: { localDate: endDate, localTime: endClock },
          timezone: typedZone,
          reason: reason.trim(),
        };

  const dayError = (typed: string, day: string | undefined) =>
    day === undefined && typed.length === WHOLE_DAY
      ? { error: t('admin.applications.detail.callDateInvalid') }
      : {};
  const timeError = (typed: string, clock: string | undefined) =>
    clock === undefined && typed.trim().length >= JUDGED_TIME
      ? { error: t('admin.outages.dialog.timeInvalid') }
      : {};
  const refusal = (at: Refused, words: MessageKey) => (refused === at ? { error: t(words) } : {});
  /** A field changed: what the server refused no longer stands. */
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setRefused(undefined);
  };
  const city = cityName(typedZone, locale);

  return (
    <Dialog
      open
      title={t('admin.outages.dialog.title')}
      leading={<IconTile icon={{ name: 'alert-circle' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: record.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.outages.dialog.confirm'),
          disabled: input === undefined,
          loading: record.isPending,
          onPress: () => {
            if (input === undefined) return;
            setRefused(undefined);
            record.mutate(input, {
              onSuccess: (answer) => onDone({ reclassified: answer.reclassified }),
              onError: (error) => setRefused(refusedAt(error)),
            });
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.outages.dialog.effect')}</span>
        </p>
      </section>
      <div className="grid-2 gap-3">
        <Field label={t('admin.outages.dialog.startDate')} {...dayError(startDay, startDate)}>
          <Input
            value={startDay}
            onChangeText={edit((value) => setStartDay(dayFieldText(value)))}
            keyboard="numeric"
            placeholder={t('admin.applications.detail.callDatePlaceholder')}
          />
        </Field>
        <Field
          label={t('admin.outages.dialog.startTime')}
          hint={t('admin.outages.dialog.timeHint')}
          {...timeError(startTime, startClock)}
        >
          <Input
            value={startTime}
            onChangeText={edit(setStartTime)}
            ltr
            placeholder={t('admin.outages.dialog.timePlaceholder')}
          />
        </Field>
        <Field label={t('admin.outages.dialog.endDate')} {...dayError(endDay, endDate)}>
          <Input
            value={endDay}
            onChangeText={edit((value) => setEndDay(dayFieldText(value)))}
            keyboard="numeric"
            placeholder={t('admin.applications.detail.callDatePlaceholder')}
          />
        </Field>
        <Field
          label={t('admin.outages.dialog.endTime')}
          hint={t('admin.outages.dialog.timeHint')}
          {...timeError(endTime, endClock)}
          {...refusal('end', 'admin.outages.dialog.refused.endNotAfterStart')}
        >
          <Input
            value={endTime}
            onChangeText={edit(setEndTime)}
            ltr
            placeholder={t('admin.outages.dialog.timePlaceholder')}
          />
        </Field>
      </div>
      <Field
        label={t('admin.outages.dialog.zone')}
        {...(city === typedZone ? {} : { hint: t('admin.outages.dialog.zoneHint', { city }) })}
        {...refusal('zone', 'admin.outages.dialog.refused.zoneUnknown')}
      >
        <Input value={zone} onChangeText={edit(setZone)} ltr />
      </Field>
      <Field
        label={t('admin.outages.dialog.reason')}
        hint={t('admin.common.reasonLoggedWithAction')}
      >
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {refused === 'other' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('admin.dialogs.submitError')}
        </Banner>
      ) : null}
    </Dialog>
  );
}
