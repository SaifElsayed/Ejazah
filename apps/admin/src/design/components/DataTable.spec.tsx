// T036: DataTable (docs/design/components.md, "The admin panel"): columns, rows, the selected row
// with its start-side indicator, numeric cells in the Latin face left to right, and a footer with
// the count and the Pager.
import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { DataTable } from './index';

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'count', header: 'Count', numeric: true },
  { key: 'state', header: 'State', end: true },
] as const;

const rows = [
  { key: 'a', cells: { name: 'Ali', count: '1,007', state: 'open' } },
  { key: 'b', cells: { name: 'Mona', count: '12', state: 'closed' } },
];

describe('DataTable', () => {
  it('heads its columns and draws numeric cells in the Latin face, the end column at the end', () => {
    inBothDirections(
      () => <DataTable columns={columns} rows={rows} />,
      ({ view }) => {
        const table = view.getByRole('table');
        expect(table.classList.contains('table')).toBe(true);
        expect(table.parentElement?.classList.contains('table-wrap')).toBe(true);
        const headers = within(table).getAllByRole('columnheader');
        expect(headers.map((header) => header.textContent)).toEqual(['Name', 'Count', 'State']);
        expect(headers.every((header) => header.getAttribute('scope') === 'col')).toBe(true);
        const cell = within(table).getByText('1,007');
        expect(cell.className).toBe('table__num');
        expect(within(table).getByText('open').className).toBe('table__end');
        expect(within(table).getByText('Ali').className).toBe('');
      },
    );
  });

  it('marks the selected row and selects a row by click or by keyboard', () => {
    const onSelect = vi.fn();
    inBothDirections(
      () => <DataTable columns={columns} rows={rows} selectedKey="a" onSelect={onSelect} />,
      ({ view }) => {
        const [, first, second] = view.getAllByRole('row');
        expect(first?.className).toBe('table__row--selected');
        expect(first?.getAttribute('aria-selected')).toBe('true');
        expect(second?.getAttribute('aria-selected')).toBe('false');
        expect(second?.getAttribute('tabindex')).toBe('0');
        fireEvent.click(second as HTMLElement);
        fireEvent.keyDown(second as HTMLElement, { key: 'Enter' });
        fireEvent.keyDown(second as HTMLElement, { key: ' ' });
        fireEvent.keyDown(second as HTMLElement, { key: 'a' });
      },
    );
    expect(onSelect.mock.calls).toEqual([['b'], ['b'], ['b'], ['b'], ['b'], ['b']]);
  });

  it('is a plain table when nothing can be selected', () => {
    inBothDirections(
      () => <DataTable columns={columns} rows={rows} />,
      ({ view }) => {
        const [, first] = view.getAllByRole('row');
        expect(first?.getAttribute('aria-selected')).toBeNull();
        expect(first?.getAttribute('tabindex')).toBeNull();
      },
    );
  });

  it('ends with the count and the pager', () => {
    inBothDirections(
      () => (
        <DataTable
          columns={columns}
          rows={rows}
          footer={{
            summary: '2 of 14',
            pager: { page: 1, pageCount: 2, onChange: () => undefined },
          }}
        />
      ),
      ({ frame }) => {
        const footer = frame.querySelector('.table-wrap > .table-footer');
        expect(footer?.firstElementChild?.textContent).toBe('2 of 14');
        expect(footer?.querySelector('.pager')).not.toBeNull();
      },
    );
  });
});
