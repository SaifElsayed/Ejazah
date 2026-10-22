// T036: Segmented, Chip, FilterChips (docs/design/components.md, "Primitives"; design
// `.segmented`, `.chip`, `.filter-chips`). Segmented is the one selected style for exclusive
// options, the language included. T070: CheckRow, the setup page's confirmation. T071: Choice and
// ChoiceGroup, the decision dialog's reasons, and CategoryTabs, a queue's tabs.
import clsx from 'clsx';
import { createContext, useContext, useId } from 'react';

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

export interface CheckRowProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Top-aligned, for a label of more than one line. */
  readonly top?: boolean;
}

/** A checkbox and its sentence, one touch target (`.check-row`, `.check`; T070). */
export function CheckRow({ label, checked, onChange, top = false }: CheckRowProps) {
  return (
    <label className={clsx('check-row', top && 'check-row--top')}>
      <input
        type="checkbox"
        className="check"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-callout">{label}</span>
    </label>
  );
}

export interface ChoiceProps {
  readonly label: string;
  readonly selected: boolean;
  /** Red when selected: a choice that refuses or ends something. */
  readonly danger?: boolean;
  readonly onPress: Press;
}

/**
 * One option of a group of radio cards (`.choice`; T071, the decision dialog's reasons). The radio
 * is visually hidden inside its label, so the card is the touch target and the group a radio group
 * for assistive technology; `ChoiceGroup` names it.
 */
export function Choice({ label, selected, danger = false, onPress }: ChoiceProps) {
  const name = useContext(ChoiceGroupContext);
  return (
    <label className={clsx('choice', danger && 'choice--danger', selected && 'choice--selected')}>
      <input
        type="radio"
        className="visually-hidden"
        name={name}
        checked={selected}
        onChange={() => onPress()}
      />
      <span className="choice__mark" aria-hidden="true" />
      <span className="grow">{label}</span>
    </label>
  );
}

const ChoiceGroupContext = createContext<string | undefined>(undefined);

export interface ChoiceGroupProps {
  /** The group's legend («سبب الرفض»). */
  readonly legend: string;
  readonly children: Content;
}

/** A fieldset of Choices under their legend, one radio group (T071). */
export function ChoiceGroup({ legend, children }: ChoiceGroupProps) {
  const name = useId();
  return (
    <fieldset className="stack gap-2">
      <legend className="field__label pad-bottom">{legend}</legend>
      <ChoiceGroupContext.Provider value={name}>{children}</ChoiceGroupContext.Provider>
    </fieldset>
  );
}

export interface CategoryTabsProps extends Required<Accessible> {
  readonly tabs: readonly {
    readonly value: string;
    readonly label: string;
    /** How many the tab holds; no count drawn when absent. */
    readonly count?: number;
  }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** The tabs of a queue with their counts (`.category-tabs`; T071). */
export function CategoryTabs({ tabs, value, onChange, accessibilityLabel }: CategoryTabsProps) {
  return (
    <div className="category-tabs" role="tablist" aria-label={accessibilityLabel}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            className={clsx('category-tabs__item', selected && 'category-tabs__item--selected')}
            onClick={() => {
              if (!selected) onChange(tab.value);
            }}
          >
            {tab.label}
            {tab.count === undefined ? null : (
              <span className="category-tabs__count">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
