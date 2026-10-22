// T036: Segmented, Chip, FilterChips (docs/design/components.md, "Primitives"). T070: CheckRow.
// T071: Choice in its ChoiceGroup, and CategoryTabs.
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '../../i18n';
import { inBothDirections } from './__tests__/harness';
import { CategoryTabs, CheckRow, Chip, Choice, ChoiceGroup, FilterChips, Segmented } from './index';

describe('Segmented', () => {
  it('is a labelled group with one pressed option, and reports a choice', () => {
    const onChange = vi.fn();
    inBothDirections(
      () => (
        <Segmented
          accessibilityLabel="group"
          inline
          value="a"
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          onChange={onChange}
        />
      ),
      ({ view }) => {
        const group = view.getByRole('group', { name: 'group' });
        expect([...group.classList]).toEqual(['segmented', 'segmented--inline']);
        const a = view.getByRole('button', { name: 'A' });
        const b = view.getByRole('button', { name: 'B' });
        expect(a.getAttribute('aria-pressed')).toBe('true');
        expect(a.classList.contains('segmented__option--selected')).toBe(true);
        expect(b.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(b);
        fireEvent.click(a);
      },
    );
    // The option already chosen is not reported again.
    expect(onChange.mock.calls).toEqual([['b'], ['b']]);
  });
});

describe('Chip', () => {
  it('is a toggle that says whether it is selected, with the remove mark when removable', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => <Chip label="chip" selected removable onPress={onPress} />,
      ({ view }) => {
        const chip = view.getByRole('button', { name: 'chip' });
        expect([...chip.classList]).toEqual(['chip', 'chip--selected', 'chip--removable']);
        expect(chip.getAttribute('aria-pressed')).toBe('true');
        expect(chip.querySelector('svg.icon')).not.toBeNull();
        fireEvent.click(chip);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('FilterChips', () => {
  it('lists the active filters, each removable, and clears them all', () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    inBothDirections(
      () => (
        <FilterChips chips={[{ key: 'date', content: 'date', onRemove }]} onClearAll={onClearAll} />
      ),
      ({ view, locale }) => {
        const group = view.getByRole('group', {
          name: translate(locale, 'admin.common.a11y.activeFilters'),
        });
        expect(group.classList.contains('filter-chips')).toBe(true);
        fireEvent.click(view.getByRole('button', { name: 'date' }));
        fireEvent.click(
          view.getByRole('button', { name: translate(locale, 'admin.common.action.clearAll') }),
        );
      },
    );
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onClearAll).toHaveBeenCalledTimes(2);
  });
});

describe('CheckRow', () => {
  it('is a checkbox labelled by its sentence, and reports a change', () => {
    const onChange = vi.fn();
    inBothDirections(
      () => <CheckRow label="saved" checked={false} onChange={onChange} />,
      ({ view }) => {
        const box = view.getByRole('checkbox', { name: 'saved' });
        expect(box).toHaveProperty('checked', false);
        fireEvent.click(box);
      },
    );
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Choice and ChoiceGroup', () => {
  it('is one radio group under its legend, the selected card marked, danger when asked', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <ChoiceGroup legend="why">
          <Choice label="first" selected danger onPress={() => undefined} />
          <Choice label="second" selected={false} onPress={onPress} />
        </ChoiceGroup>
      ),
      ({ view }) => {
        const group = view.getByRole('group', { name: 'why' });
        const [first, second] = view.getAllByRole('radio');
        expect(first).toHaveProperty('checked', true);
        expect(second).toHaveProperty('checked', false);
        expect(first?.getAttribute('name')).toBe(second?.getAttribute('name'));
        expect(group.querySelector('.choice--danger.choice--selected')).not.toBeNull();
        fireEvent.click(view.getByLabelText('second'));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('CategoryTabs', () => {
  it('is a tab list with the selected tab and the counts given, and reports another tab', () => {
    const onChange = vi.fn();
    inBothDirections(
      () => (
        <CategoryTabs
          accessibilityLabel="state"
          value="a"
          tabs={[
            { value: 'a', label: 'A', count: 2 },
            { value: 'b', label: 'B' },
          ]}
          onChange={onChange}
        />
      ),
      ({ view }) => {
        expect(view.getByRole('tablist', { name: 'state' })).toBeTruthy();
        const [a, b] = view.getAllByRole('tab');
        expect(a?.getAttribute('aria-selected')).toBe('true');
        expect(a?.textContent).toBe('A2');
        expect(b?.textContent).toBe('B');
        fireEvent.click(a as HTMLElement);
        fireEvent.click(b as HTMLElement);
      },
    );
    expect(onChange.mock.calls).toEqual([['b'], ['b']]);
  });
});
