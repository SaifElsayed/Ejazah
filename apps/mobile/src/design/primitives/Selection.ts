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
