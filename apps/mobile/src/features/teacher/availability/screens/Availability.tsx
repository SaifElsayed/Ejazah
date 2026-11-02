// T022 (FR-313, FR-317, FR-318; screens.md §13 Availability): the teacher's weekly slots, one block
// per day from Saturday, today's on the surface colour, each slot in its state (free, booked with
// the dot, disabled), the days without slots on one line and the legend. The header names the
// teacher's city and «موعد» opens the editor for a new slot; a free or disabled slot opens it for
// that slot (`pressOf`, week.ts). With no slot at all, `AvailabilityEmpty`. While nothing is read,
// the shared states; over the cached week, the offline notice (the `MainOffline` pattern).
import type { TeacherSlot } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { useState } from 'react';
import { View } from 'react-native';

import { Skeleton, Text } from '../../../../design/primitives';
import { useLocale, useT } from '../../../../i18n';
import { useFormatters, weekdayIn } from '../../../../lib/formatters';
import { TabScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useSlots } from '../api';
import { AvailabilityHeader } from '../components/AvailabilityHeader';
import { DayBlock, SlotLegend } from '../components/DayBlock';
import { SlotEditor } from '../components/SlotEditor';
import { weekOf } from '../week';
import { AvailabilityEmpty } from './AvailabilityEmpty';

/** The editor open on a new slot (`{}`) or on one of the teacher's. */
type Editing = { readonly slot?: TeacherSlot } | null;

export function Availability() {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const slots = useSlots();
  const [editing, setEditing] = useState<Editing>(null);
  const answer = slots.data;
  const retry = () => void slots.refetch();

  if (answer === undefined) {
    return (
      <TabScreen header={<AvailabilityHeader />}>
        <NotLoaded failed={slots.isError} onRetry={retry} loading={<Skeleton shape="block" />} />
      </TabScreen>
    );
  }

  const city = cityOf(answer.timezone, locale) ?? answer.timezone;
  const editor =
    editing === null ? null : (
      <SlotEditor
        {...(editing.slot === undefined ? {} : { slot: editing.slot })}
        timezone={answer.timezone}
        onClose={() => setEditing(null)}
      />
    );

  if (answer.slots.length === 0) {
    return (
      <>
        <AvailabilityEmpty
          city={city}
          onAdd={() => setEditing({})}
          notice={<OfflineNotice onRetry={retry} />}
        />
        {editor}
      </>
    );
  }

  const week = weekOf(answer.slots);
  const today = weekdayIn(new Date().toISOString(), answer.timezone);
  return (
    <TabScreen header={<AvailabilityHeader city={city} onAdd={() => setEditing({})} />}>
      <OfflineNotice onRetry={retry} />
      <View>
        {week.days.map(({ dayOfWeek, slots: ofDay }) => (
          <DayBlock
            key={dayOfWeek}
            dayOfWeek={dayOfWeek}
            slots={ofDay}
            today={dayOfWeek === today}
            onOpen={(slot) => setEditing({ slot })}
          />
        ))}
      </View>
      {week.withoutSlots.length === 0 ? null : (
        <Text variant="caption" tone="muted">
          {t('teacher.availability.noSlotsOn', {
            days: week.withoutSlots
              .map((dayOfWeek) => format.weekday(dayOfWeek))
              .join(t('teacher.availability.daysSeparator')),
          })}
        </Text>
      )}
      <SlotLegend />
      {editor}
    </TabScreen>
  );
}
