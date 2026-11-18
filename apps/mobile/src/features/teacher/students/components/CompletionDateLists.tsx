// 005:T019 (FR-603): the request's completion date, chosen in three lists side by side (day, month,
// year) inside the request's sheet, in the app's language and direction, as the date of birth is
// chosen (T109, `features/shared/onboarding/birth-date.ts`, whose choices this reuses). The lists
// offer only dates between `earliest` and `latest` (the teacher's today on the device; the server
// refuses a later one in the teacher's own zone); Done hands the date back.
import { useRef, useState } from 'react';
import { ScrollView, type ScrollViewInstance, View } from 'react-native';

import { Button, List, ListRow } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import {
  type CalendarParts,
  choicesOf,
  clampParts,
  dateOfParts,
  partsOf,
} from '../../../shared/onboarding/birth-date';

export function CompletionDateLists({
  initial,
  earliest,
  latest,
  onDone,
}: {
  /** The date the lists open on, `YYYY-MM-DD`. */
  readonly initial: string;
  readonly earliest: string;
  readonly latest: string;
  readonly onDone: (date: string) => void;
}) {
  const t = useT();
  const format = useFormatters();
  const first = partsOf(earliest);
  const last = partsOf(latest);
  const [parts, setParts] = useState(() => clampParts(partsOf(initial), first, last));
  const choices = choicesOf(parts, first, last);
  const choose = (change: Partial<CalendarParts>) =>
    setParts((current) => clampParts({ ...current, ...change }, first, last));

  return (
    <>
      <View style={{ flexDirection: 'row', gap: tokens.space['2'] }}>
        <Column
          label={t('onboarding.profile.birthDay')}
          options={choices.days.map((day) => ({ value: day, label: format.number(day) }))}
          value={parts.day}
          onChange={(day) => choose({ day })}
        />
        <Column
          label={t('onboarding.profile.birthMonth')}
          wide
          options={choices.months.map((month) => ({ value: month, label: format.month(month) }))}
          value={parts.month}
          onChange={(month) => choose({ month })}
        />
        <Column
          label={t('onboarding.profile.birthYear')}
          options={choices.years.map((year) => ({ value: year, label: format.year(year) }))}
          value={parts.year}
          onChange={(year) => choose({ year })}
        />
      </View>
      <Button
        label={t('common.action.done')}
        layout="block"
        onPress={() => onDone(dateOfParts(parts))}
      />
    </>
  );
}

/** One list, scrolled to its chosen row when it opens. */
function Column({
  label,
  wide = false,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly options: readonly { readonly value: number; readonly label: string }[];
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const placed = useRef(false);
  return (
    <View style={{ flex: wide ? 2 : 1, minWidth: 0 }}>
      <List header={label}>
        <ScrollView ref={scroller} style={{ maxHeight: tokens.size['media-preview'] }}>
          {options.map((option) => (
            <View
              key={option.value}
              {...(option.value === value
                ? {
                    onLayout: ({ nativeEvent }) => {
                      if (placed.current) return;
                      placed.current = true;
                      scroller.current?.scrollTo({ y: nativeEvent.layout.y, animated: false });
                    },
                  }
                : {})}
            >
              <ListRow
                label={option.label}
                tone={option.value === value ? 'selected' : 'default'}
                trailing={false}
                onPress={() => onChange(option.value)}
              />
            </View>
          ))}
        </ScrollView>
      </List>
    </View>
  );
}
