import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { useTheme } from '../theme';
import { InputGroup } from './Forms';
import { Glyph } from './Icon';
import { border, opacity, pressed, radius, shadow, size, space } from './style';
import { Words } from './Text';
import type { Accessible, Content, IconSpec, Press } from './types';

/**
 * Segmented: one choice among two or three. The only selected style for exclusive options,
 * language included. Design: `.segmented`, `.segmented__option--selected`.
 */
export interface SegmentedProps extends Required<Accessible> {
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly icon?: IconSpec;
  }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Hugs its content instead of filling the row. */
  readonly inline?: boolean;
}

/**
 * Chip: a filter or a multi-select tag, pill-shaped, at the touch height. A removable chip shows
 * the applied filter with an x that removes it. Design: `.chip`, `.chip--selected`, `.chip--removable`.
 */
export interface ChipProps extends Accessible {
  readonly label?: string;
  /** Stars for the rating filter: the chip shows icons instead of a label. */
  readonly content?: Content;
  readonly selected?: boolean;
  readonly removable?: boolean;
  readonly onPress: Press;
}

/**
 * Slot: a time the student can pick or the teacher has published. `booked` carries the dot and is
 * not pressable; `disabled` is dashed. Design: `.slot`, `.slot--selected|booked|disabled`.
 */
export interface SlotProps extends Accessible {
  readonly label: string;
  readonly state?: 'available' | 'selected' | 'booked' | 'disabled';
  readonly onPress?: Press;
}

/** CheckRow: a checkbox with its label as one touch target. Design: `.check-row`, `.check`. */
export interface CheckRowProps {
  readonly label: Content;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Multi-line label: the box aligns to the first line. */
  readonly top?: boolean;
}

/**
 * Choice: one of several reasons or decisions (a radio with a card body). Design: `.choice`,
 * `.choice--selected`, `.choice--danger`.
 */
export interface ChoiceProps {
  readonly label: Content;
  readonly selected: boolean;
  readonly danger?: boolean;
  readonly onPress: Press;
}

/**
 * Picker: a searchable list of choices inside a Sheet (a subject, a time zone, a session). The
 * sheet closes on a choice. Design: `.picker` inside `.sheet`.
 */
export interface PickerProps<Value extends string = string> {
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
    readonly hint?: string;
    readonly disabled?: boolean;
  }[];
  readonly value?: Value;
  readonly onChange: (value: Value) => void;
  readonly searchPlaceholder?: string;
}

/**
 * Select: a field whose value comes from a long list; opens a Picker. Design: `.select`,
 * `.select--md`, `.select__placeholder`.
 */
export interface SelectProps extends Accessible {
  readonly label: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly size?: 'md' | 'lg';
  readonly onPress: Press;
}

/**
 * CategoryTabs: the sections of one list (the subjects of a package list), quiet text tabs that
 * scroll sideways, each with its count. Design: `.category-tabs`, `.category-tabs__item--selected`.
 */
export interface CategoryTabsProps extends Required<Accessible> {
  readonly tabs: readonly {
    readonly value: string;
    readonly label: string;
    readonly count?: number;
  }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

// ---------------------------------------------------------------------------------------------
// T032: the implementations. Slot and CategoryTabs are contracts of later phases' screens and are
// implemented with them.

export function Segmented({
  options,
  value,
  onChange,
  inline = false,
  accessibilityLabel,
}: SegmentedProps) {
  const { color } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        alignSelf: inline ? 'flex-start' : 'stretch',
        gap: space['1'],
        padding: space['1'],
        borderWidth: border.hairline,
        borderColor: color.border,
        borderRadius: radius.md,
        backgroundColor: color.surface,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            cssInterop={false}
            style={({ pressed: down }) => [
              {
                flex: inline ? 0 : 1,
                height: size.touch,
                paddingHorizontal: space['4'],
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: space['2'],
                borderRadius: radius.sm,
                backgroundColor: selected ? color.bg : 'transparent',
              },
              selected ? { boxShadow: shadow('sm', color) } : null,
              down ? pressed : null,
            ]}
          >
            {option.icon === undefined ? null : (
              <Glyph {...option.icon} color={selected ? 'text' : 'text-muted'} />
            )}
            <Words
              weight={selected ? 'bold' : 'medium'}
              color={selected ? 'text' : 'text-muted'}
              numberOfLines={1}
            >
              {option.label}
            </Words>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  content,
  selected = false,
  removable = false,
  accessibilityLabel,
  onPress,
}: ChipProps) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      {...((accessibilityLabel ?? label) === undefined
        ? {}
        : { accessibilityLabel: accessibilityLabel ?? label })}
      accessibilityState={{ selected }}
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: space['2'],
          height: size.touch,
          paddingHorizontal: space['4'],
          borderWidth: selected ? border.selected : border.hairline,
          borderColor: selected ? color.primary : color['border-strong'],
          borderRadius: radius.full,
          backgroundColor: selected ? color['primary-subtle'] : color.bg,
        },
        removable ? { paddingEnd: space['2'] } : null,
        down ? pressed : null,
      ]}
    >
      {content ?? (
        <Words
          weight={selected ? 'medium' : 'regular'}
          color={selected ? 'primary-strong' : 'text'}
          numberOfLines={1}
        >
          {label}
        </Words>
      )}
      {removable ? <Glyph name="x" size="sm" color="text-muted" /> : null}
    </Pressable>
  );
}

export function CheckRow({ label, checked, onChange, top = false }: CheckRowProps) {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          flexDirection: 'row',
          alignItems: top ? 'flex-start' : 'center',
          gap: space['3'],
          minHeight: size.touch,
          paddingVertical: top ? space['3'] : 0,
        },
        down ? pressed : null,
      ]}
    >
      <View
        style={{
          width: size.check,
          height: size.check,
          marginTop: top ? space.half : 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: border.selected,
          borderRadius: radius.xs,
          borderColor: checked ? color.primary : color['border-strong'],
          backgroundColor: checked ? color.primary : color.bg,
        }}
      >
        {checked ? <Glyph name="check" size="xs" stroke="heavy" color="on-primary" /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof label === 'string' ? <Words color="text">{label}</Words> : label}
      </View>
    </Pressable>
  );
}

/** A choice that may be unavailable (a Picker's disabled option, `.choice--disabled`). */
function ChoiceRow({
  label,
  selected,
  danger = false,
  disabled = false,
  onPress,
}: ChoiceProps & { readonly disabled?: boolean }) {
  const { color } = useTheme();
  const tint = danger ? 'danger' : 'primary';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space['3'],
          minHeight: size['list-row'],
          paddingVertical: space['3'],
          paddingHorizontal: space['4'],
          borderWidth: border.hairline,
          borderRadius: radius.md,
          borderColor: selected ? color[tint] : color.border,
          backgroundColor: selected ? color[`${tint}-subtle`] : color['surface-raised'],
        },
        disabled ? { opacity: opacity.disabled } : null,
        down ? pressed : null,
      ]}
    >
      {/* The radio mark: a ring, and when selected a dot inside a gap (`.choice__mark`). */}
      <View
        style={{
          width: size.check,
          height: size.check,
          padding: space['1'],
          borderRadius: radius.full,
          borderWidth: border.selected,
          borderColor: selected ? color[tint] : color['border-strong'],
        }}
      >
        {selected ? (
          <View style={{ flex: 1, borderRadius: radius.full, backgroundColor: color[tint] }} />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof label === 'string' ? <Words color="text">{label}</Words> : label}
      </View>
    </Pressable>
  );
}

export function Choice(props: ChoiceProps) {
  return <ChoiceRow {...props} />;
}

export function Picker<Value extends string = string>({
  options,
  value,
  onChange,
  searchPlaceholder,
}: PickerProps<Value>) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const wanted = query.trim().toLocaleLowerCase();
    return wanted === ''
      ? options
      : options.filter((option) => option.label.toLocaleLowerCase().includes(wanted));
  }, [options, query]);
  return (
    <View style={{ gap: space['2'] }}>
      {searchPlaceholder === undefined ? null : (
        <InputGroup
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          leadingIcon={{ name: 'search' }}
          surface
        />
      )}
      <View style={{ gap: space['2'], maxHeight: size['media-preview'] }}>
        {shown.map((option) => (
          <ChoiceRow
            key={option.value}
            selected={option.value === value}
            disabled={option.disabled === true}
            onPress={() => onChange(option.value)}
            label={
              <View>
                <Words color="text">{option.label}</Words>
                {option.hint === undefined ? null : (
                  <Words variant="caption" color="text-muted">
                    {option.hint}
                  </Words>
                )}
              </View>
            }
          />
        ))}
      </View>
    </View>
  );
}

export function Select({
  label,
  value,
  placeholder,
  size: height = 'lg',
  accessibilityLabel,
  onPress,
}: SelectProps) {
  const { color } = useTheme();
  const shown = value ?? placeholder;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      {...(value === undefined ? {} : { accessibilityValue: { text: value } })}
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space['3'],
          alignSelf: 'stretch',
          height: height === 'lg' ? size['control-lg'] : size['control-md'],
          paddingHorizontal: space['4'],
          borderWidth: border.hairline,
          borderColor: color['border-strong'],
          borderRadius: radius.md,
          backgroundColor: color.bg,
        },
        down ? pressed : null,
      ]}
    >
      {shown === undefined ? (
        <View style={{ flex: 1 }} />
      ) : (
        <Words
          variant={height === 'lg' ? 'body-lg' : 'body'}
          color={value === undefined ? 'text-subtle' : 'text'}
          numberOfLines={1}
        >
          {shown}
        </Words>
      )}
      <Glyph name="chevron-down" color="text-muted" />
    </Pressable>
  );
}
