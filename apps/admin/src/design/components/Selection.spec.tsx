// T036: Segmented, Chip, FilterChips (docs/design/components.md, "Primitives").
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '../../i18n';
import { inBothDirections } from './__tests__/harness';
import { Chip, FilterChips, Segmented } from './index';

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
