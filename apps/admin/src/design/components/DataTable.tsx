// T036: DataTable (docs/design/components.md, "The admin panel"; design `.table`). Columns, rows,
// the selected row (its start-side indicator is the stylesheet's, in both directions), numeric cells
// in the Latin face left to right (`.table__num`), and a footer with the count and the Pager. A
// selectable row is reached by Tab and chosen by click, Enter or Space. T111: a long text cell ends in
// an ellipsis after two lines (`.table__clip`), its full text in its title; the live console scrolls
// the table sideways rather than clipping it.
import clsx from 'clsx';
import type { KeyboardEvent } from 'react';

import { Pager, type PagerProps } from './Console';
import type { Content } from './types';

export interface DataTableColumn {
  readonly key: string;
  readonly header: string;
  /** A count, an amount, a reference: the Latin face, left to right. */
  readonly numeric?: boolean;
  /** Aligned to the end (a state, an action). */
  readonly end?: boolean;
  /** Text that may wrap (a reason); every other cell stays on one line. */
  readonly wrap?: boolean;
  /** Long text that ends in an ellipsis after two lines, its full text in the row's `titles`. */
  readonly clip?: boolean;
}

export interface DataTableProps {
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly {
    readonly key: string;
    readonly cells: Readonly<Record<string, Content>>;
    /** The full text of a clipped cell, shown on hover. */
    readonly titles?: Readonly<Record<string, string>>;
  }[];
  readonly selectedKey?: string;
  readonly onSelect?: (key: string) => void;
  readonly footer?: { readonly summary: string; readonly pager?: PagerProps };
}

function cellClass(column: DataTableColumn): string | undefined {
  return (
    clsx(
      column.numeric && 'table__num',
      column.end && 'table__end',
      column.wrap && 'table__wrap',
    ) || undefined
  );
}

export function DataTable({ columns, rows, selectedKey, onSelect, footer }: DataTableProps) {
  const selectable = onSelect !== undefined;
  const onKeyDown = (key: string) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect?.(key);
  };
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.end ? 'table__end' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.key === selectedKey;
            return (
              <tr
                key={row.key}
                className={selected ? 'table__row--selected' : undefined}
                aria-selected={selectable ? selected : undefined}
                tabIndex={selectable ? 0 : undefined}
                onClick={selectable ? () => onSelect(row.key) : undefined}
                onKeyDown={selectable ? onKeyDown(row.key) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {column.clip ? (
                      <span className="table__clip" title={row.titles?.[column.key]}>
                        {row.cells[column.key]}
                      </span>
                    ) : (
                      row.cells[column.key]
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer === undefined ? null : (
        <div className="table-footer">
          <span>{footer.summary}</span>
          {footer.pager === undefined ? null : <Pager {...footer.pager} />}
        </div>
      )}
    </div>
  );
}
