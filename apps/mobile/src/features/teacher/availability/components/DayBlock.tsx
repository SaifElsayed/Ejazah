// T022 (FR-313; components.md DayBlock): a weekday with its slots, today's on the surface colour,
// and the legend's three swatches. A slot reads «{time} · {minutes} د» in its own zone, labelled
// for a screen reader with its day, its time and its state; which slot opens the editor is
// `pressOf`'s (week.ts).
import type { SlotState, TeacherSlot } from '@ijazah/contracts';
import { View } from 'react-native';

import { Slot, type SlotProps, Text } from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { pressOf } from '../week';

/** The Slot primitive's look of each state the server derives. */
const SLOT_LOOK = {
  free: 'available',
  booked: 'booked',
  disabled: 'disabled',
} as const satisfies Record<SlotState, NonNullable<SlotProps['state']>>;

/** The screen reader's label of each state (the boards' «…، محجوز» / «…، معطّل»). */
const SLOT_A11Y = {
  free: 'teacher.availability.a11y.editSlot',
  booked: 'teacher.availability.a11y.editSlotBooked',
  disabled: 'teacher.availability.a11y.editSlotDisabled',
} as const satisfies Record<SlotState, MessageKey>;

export function DayBlock({
  dayOfWeek,
  slots,
  today,
  onOpen,
}: {
  readonly dayOfWeek: number;
  readonly slots: readonly TeacherSlot[];
  readonly today: boolean;
  readonly onOpen: (slot: TeacherSlot) => void;
}) {
  const t = useT();
  const format = useFormatters();
  const { color } = useTheme();
  const day = format.weekday(dayOfWeek);
  return (
    <View
      style={{
        gap: tokens.space['2'],
        paddingVertical: tokens.space['3'],
        // `.day-block` runs to the screen's edges, its content on the gutter.
        marginHorizontal: -tokens.layout.gutter,
        paddingHorizontal: tokens.layout.gutter,
        borderBottomWidth: tokens.borderWidth.hairline,
        borderColor: color.border,
        ...(today ? { backgroundColor: color.surface } : {}),
      }}
    >
      <Text variant="callout" weight="bold">
        {day}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] }}>
        {slots.map((slot) => {
          const time = format.wallClock(slot.startTimeLocal);
          const press = pressOf(slot.state, () => onOpen(slot));
          return (
            <Slot
              key={slot.id}
              label={t('teacher.availability.slot', { time, minutes: slot.durationMinutes })}
              state={SLOT_LOOK[slot.state]}
              accessibilityLabel={t(SLOT_A11Y[slot.state], { day, time })}
              {...(press === undefined ? {} : { onPress: press })}
            />
          );
        })}
      </View>
    </View>
  );
}

/** `.legend-swatch` of each state, as the Slot primitive paints it. */
function Swatch({ state }: { readonly state: SlotState }) {
  const { color } = useTheme();
  const booked = state === 'booked';
  return (
    <View
      style={{
        width: tokens.space['3'],
        height: tokens.space['3'],
        borderRadius: tokens.radius.xs,
        borderWidth: tokens.borderWidth.hairline,
        borderStyle: state === 'disabled' ? 'dashed' : 'solid',
        borderColor: booked ? color['primary-subtle'] : color['border-strong'],
        ...(booked ? { backgroundColor: color['primary-subtle'] } : {}),
      }}
    />
  );
}

const LEGEND = [
  { state: 'booked', label: 'teacher.availability.legend.booked' },
  { state: 'free', label: 'teacher.availability.legend.free' },
  { state: 'disabled', label: 'teacher.availability.legend.disabled' },
] as const satisfies readonly { state: SlotState; label: MessageKey }[];

/** The legend under the week: محجوز · متاح · معطّل. */
export function SlotLegend() {
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['4'] }}>
      {LEGEND.map(({ state, label }) => (
        <View
          key={state}
          style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['2'] }}
        >
          <Swatch state={state} />
          <Text variant="micro" tone="muted">
            {t(label)}
          </Text>
        </View>
      ))}
    </View>
  );
}
