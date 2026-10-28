// T109: the date-of-birth picker of the onboarding's profile, the app's own: three lists side by
// side (day, month, year) in one sheet, in the app's language and direction on both platforms.
// Android's picker takes no locale, so it showed the system's language, left to right, in the
// system's colour (the owner's decision, 2026-10-28). The lists offer only dates between `earliest`
// and `latest`, and a day the new month or year lacks moves to its last (`birth-date.ts`); Done
// hands the date back, closing keeps nothing.
import { useRef, useState } from 'react';
import { ScrollView, type ScrollViewInstance, View } from 'react-native';

import { Button, List, ListRow, Sheet } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { type CalendarParts, choicesOf, clampParts, dateOfParts, partsOf } from '../birth-date';

export function BirthDateSheet({
  initial,
  earliest,
  latest,
  onDone,
  onClose,
}: {
  /** The date the lists open on, `YYYY-MM-DD`. */
  readonly initial: string;
  readonly earliest: string;
  readonly latest: string;
  readonly onDone: (date: string) => void;
  readonly onClose: () => void;
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
    <Sheet open onClose={onClose} title={t('onboarding.profile.dateOfBirth')}>
      <View style={{ flexDirection: 'row', gap: tokens.space['2'] }}>
        <Column
          label={t('onboarding.profile.birthDay')}
          options={choices.days.map((day) => ({ value: day, label: format.number(day) }))}
          value={parts.day}
          onChange={(day) => choose({ day })}
        />
        <Column
          label={t('onboarding.profile.birthMonth')}
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
    </Sheet>
  );
}

/** One list, scrolled to its chosen row when it opens. */
function Column({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: number; readonly label: string }[];
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const scroller = useRef<ScrollViewInstance>(null);
  const placed = useRef(false);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
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
