// T036: Card, List, Summary, Avatar, IconTile (docs/design/components.md, "Primitives").
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { Avatar, Card, IconTile, List, ListRow, Summary } from './index';

describe('Card', () => {
  it('is a surface of its variant, and a button when it can be pressed', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <>
          <Card variant="compact">still</Card>
          <Card variant="selected" onPress={onPress}>
            pressed
          </Card>
        </>
      ),
      ({ view }) => {
        expect([...(view.getByText('still').classList ?? [])]).toEqual(['card', 'card--compact']);
        const pressable = view.getByRole('button', { name: 'pressed' });
        expect([...pressable.classList]).toEqual(['card', 'card--selected']);
        fireEvent.click(pressable);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('List', () => {
  it('groups rows under a header, a value at the end of its row', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <List header="header">
          <ListRow label="still" value="value" />
          <ListRow label="pressed" tone="danger" onPress={onPress} />
        </List>
      ),
      ({ view, frame }) => {
        expect(frame.querySelector('.list > .list__header')?.textContent).toBe('header');
        expect(view.getByText('value').classList.contains('list__value')).toBe(true);
        const row = view.getByRole('button', { name: 'pressed' });
        expect([...row.classList]).toEqual(['list__row', 'list__row--danger']);
        fireEvent.click(row);
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('Summary', () => {
  it('is label and value rows, the total and the emphasis marked', () => {
    inBothDirections(
      () => (
        <Summary
          rows={[
            { label: 'a', value: '1' },
            { label: 'b', value: '2', kind: 'total' },
            { label: 'c', value: '3', kind: 'emphasis' },
          ]}
        />
      ),
      ({ frame }) => {
        const rows = [...frame.querySelectorAll('.summary > .summary__row')];
        expect(rows.map((row) => [...row.classList])).toEqual([
          ['summary__row'],
          ['summary__row', 'summary__row--total'],
          ['summary__row', 'summary__row--emphasis'],
        ]);
        expect(rows[1]?.querySelector('.summary__label')?.textContent).toBe('b');
        expect(rows[1]?.querySelector('.summary__value')?.textContent).toBe('2');
      },
    );
  });
});

describe('Avatar', () => {
  it('is a person: initials or a photo, round, at its size and tone, decorative', () => {
    inBothDirections(
      () => (
        <>
          <Avatar initials="س" size="sm" tone="primary" />
          <Avatar initials="ي" imageUri="https://example.test/p.png" />
        </>
      ),
      ({ frame }) => {
        const [initials, photo] = frame.querySelectorAll('.avatar');
        expect([...(initials?.classList ?? [])]).toEqual([
          'avatar',
          'avatar--sm',
          'avatar--primary',
        ]);
        expect(initials?.textContent).toBe('س');
        expect(initials?.getAttribute('aria-hidden')).toBe('true');
        expect(photo?.querySelector('img')?.getAttribute('alt')).toBe('');
      },
    );
  });
});

describe('IconTile', () => {
  it('is a thing: an icon in a tinted square of its size and tone', () => {
    inBothDirections(
      () => <IconTile icon={{ name: 'award' }} size="lg" tone="accent" round />,
      ({ frame }) => {
        const tile = frame.querySelector('.icon-tile');
        expect([...(tile?.classList ?? [])]).toEqual([
          'icon-tile',
          'icon-tile--lg',
          'icon-tile--accent',
          'icon-tile--round',
        ]);
        expect(tile?.querySelector('svg.icon')).not.toBeNull();
      },
    );
  });
});
