// T072: ChainInput, one generation of a chain as the transcription draws it (`AdminCredentials`, the
// `.chain-input` row): its number, its names as removable chips, «+ اسم» that opens a field in the
// row, and the generation's removal. A generation the correction changed is marked.
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '../../i18n';
import { inBothDirections } from './__tests__/harness';
import { ChainInput } from './index';

type Key = Parameters<typeof translate>[1];
const in_ = (locale: 'ar' | 'en') => (key: Key, values?: Record<string, string | number>) =>
  translate(locale, key, values);

describe('ChainInput', () => {
  it('draws the number, the names as chips, and reports a removed name and a removed generation', () => {
    const onRemoveName = vi.fn();
    const onRemove = vi.fn();
    inBothDirections(
      () => (
        <ol>
          <ChainInput
            position={2}
            names={['عثمان بن عفان', 'أُبيّ بن كعب']}
            onAddName={vi.fn()}
            onRemoveName={onRemoveName}
            onRemove={onRemove}
          />
        </ol>
      ),
      ({ view, locale }) => {
        const t = in_(locale);
        const row = view.container.querySelector('li');
        expect(row?.classList.contains('chain-input')).toBe(true);
        expect(view.getByText('2').classList.contains('icon-tile--neutral')).toBe(true);
        fireEvent.click(
          view.getByRole('button', {
            name: t('admin.credentials.a11y.removeName', { name: 'أُبيّ بن كعب' }),
          }),
        );
        fireEvent.click(
          view.getByRole('button', {
            name: t('admin.credentials.a11y.deleteGeneration', { n: 2 }),
          }),
        );
      },
    );
    expect(onRemoveName.mock.calls).toEqual([[1], [1]]);
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('adds a name typed in the row on Enter, trimmed, and keeps nothing empty', () => {
    const onAddName = vi.fn();
    inBothDirections(
      () => (
        <ol>
          <ChainInput
            position={1}
            names={[]}
            onAddName={onAddName}
            onRemoveName={vi.fn()}
            onRemove={vi.fn()}
          />
        </ol>
      ),
      ({ view, locale }) => {
        const t = in_(locale);
        fireEvent.click(view.getByRole('button', { name: t('admin.credentials.panel.addName') }));
        const field = view.getByRole('textbox', {
          name: t('admin.credentials.panel.generationNameLabel', { n: 1 }),
        });
        fireEvent.change(field, { target: { value: '   ' } });
        fireEvent.keyDown(field, { key: 'Enter' });
        fireEvent.change(field, { target: { value: '  رسول الله ﷺ ' } });
        fireEvent.keyDown(field, { key: 'Enter' });
      },
    );
    expect(onAddName.mock.calls).toEqual([['رسول الله ﷺ'], ['رسول الله ﷺ']]);
  });

  it('marks a generation the correction changed', () => {
    inBothDirections(
      () => (
        <ol>
          <ChainInput
            position={34}
            names={['الشيخ محمد عبد الحميد']}
            changed
            onAddName={vi.fn()}
            onRemoveName={vi.fn()}
            onRemove={vi.fn()}
          />
        </ol>
      ),
      ({ view }) => {
        expect(view.getByText('34').classList.contains('icon-tile--primary')).toBe(true);
      },
    );
  });
});
