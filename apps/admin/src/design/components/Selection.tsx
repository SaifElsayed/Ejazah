// T036: Segmented, Chip, FilterChips (docs/design/components.md, "Primitives"; design
// `.segmented`, `.chip`, `.filter-chips`). Segmented is the one selected style for exclusive
// options, the language included.
import clsx from 'clsx';

import { useT } from '../../i18n';
import { Icon } from './Icon';
import type { Accessible, Content, IconSpec, Press } from './types';

export interface SegmentedProps extends Required<Accessible> {
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly icon?: IconSpec;
  }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** As wide as its options rather than its container. */
  readonly inline?: boolean;
}

export function Segmented({
  options,
  value,
  onChange,
  inline = false,
  accessibilityLabel,
}: SegmentedProps) {
  return (
    <div
      className={clsx('segmented', inline && 'segmented--inline')}
      role="group"
      aria-label={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={clsx('segmented__option', selected && 'segmented__option--selected')}
            aria-pressed={selected}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
          >
            {option.icon === undefined ? null : <Icon {...option.icon} size="sm" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ChipProps extends Accessible {
  readonly label?: string;
  /** Rich content (a filter's name and value); `label` when plain text is enough. */
  readonly content?: Content;
  readonly selected?: boolean;
  /** Draws the remove mark: pressing the chip removes it. */
  readonly removable?: boolean;
  readonly onPress: Press;
}

export function Chip({
  label,
  content,
  selected = false,
  removable = false,
  onPress,
  accessibilityLabel,
}: ChipProps) {
  return (
    <button
      type="button"
      className={clsx('chip', selected && 'chip--selected', removable && 'chip--removable')}
      aria-pressed={selected}
      aria-label={accessibilityLabel}
      onClick={onPress}
    >
      {content ?? label}
      {removable ? <Icon name="x" size="xs" /> : null}
    </button>
  );
}

export interface FilterChipsProps {
  readonly chips: readonly {
    readonly key: string;
    readonly content: Content;
    readonly onRemove: Press;
  }[];
  readonly onClearAll: Press;
}

/** The active filters, each a removable chip, and «مسح الكل». */
export function FilterChips({ chips, onClearAll }: FilterChipsProps) {
  const t = useT();
  return (
    <div className="filter-chips" role="group" aria-label={t('admin.common.a11y.activeFilters')}>
      {chips.map((chip) => (
        <Chip key={chip.key} content={chip.content} selected removable onPress={chip.onRemove} />
      ))}
      <button type="button" className="link link--muted" onClick={onClearAll}>
        {t('admin.common.action.clearAll')}
      </button>
    </div>
  );
}
