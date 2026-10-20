// T036: Badge, Banner, Toast, Skeleton, EmptyState (docs/design/components.md, "Primitives").
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { Badge, Banner, EmptyState, Skeleton, Toast } from './index';

describe('Badge', () => {
  it('is its label in its tone', () => {
    inBothDirections(
      () => <Badge label="label" tone="warning" icon={{ name: 'clock' }} />,
      ({ view }) => {
        const badge = view.getByText('label').closest('.badge');
        expect([...(badge?.classList ?? [])]).toEqual(['badge', 'badge--warning']);
        expect(badge?.querySelector('svg.icon')).not.toBeNull();
      },
    );
  });
});

describe('Banner', () => {
  it('is neutral by default and takes a tone', () => {
    inBothDirections(
      () => (
        <>
          <Banner icon={{ name: 'lock' }}>neutral</Banner>
          <Banner icon={{ name: 'info' }} tone="info">
            info
          </Banner>
        </>
      ),
      ({ view }) => {
        expect([...(view.getByText('neutral').closest('.banner')?.classList ?? [])]).toEqual([
          'banner',
        ]);
        expect([...(view.getByText('info').closest('.banner')?.classList ?? [])]).toEqual([
          'banner',
          'banner--info',
        ]);
      },
    );
  });

  it('is announced at once when it carries an error', () => {
    inBothDirections(
      () => (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          failed
        </Banner>
      ),
      ({ view }) => expect(view.getByRole('alert').textContent).toContain('failed'),
    );
  });
});

describe('Toast', () => {
  it('confirms politely, as a status', () => {
    inBothDirections(
      () => <Toast message="done" icon={{ name: 'check' }} />,
      ({ view }) => {
        const toast = view.getByRole('status');
        expect(toast.classList.contains('toast')).toBe(true);
        expect(toast.getAttribute('aria-live')).toBe('polite');
        expect(toast.textContent).toBe('done');
      },
    );
  });
});

describe('Skeleton', () => {
  it('is a loading shape, hidden from the screen reader', () => {
    inBothDirections(
      () => <Skeleton shape="text" width="1/2" />,
      ({ frame }) => {
        const shape = frame.querySelector('.skeleton');
        expect([...(shape?.classList ?? [])]).toEqual([
          'skeleton',
          'skeleton--text',
          'skeleton--w-1-2',
        ]);
        expect(shape?.getAttribute('aria-hidden')).toBe('true');
      },
    );
  });
});

describe('EmptyState', () => {
  it('says what is missing, why, and offers the one next step', () => {
    const onPress = vi.fn();
    inBothDirections(
      () => (
        <EmptyState
          icon={{ name: 'book' }}
          title="title"
          text="text"
          action={{ label: 'act', onPress }}
        />
      ),
      ({ view, frame }) => {
        expect(frame.querySelector('.empty-state .icon-tile.icon-tile--lg')).not.toBeNull();
        expect(view.getByText('title').classList.contains('empty-state__title')).toBe(true);
        expect(view.getByText('text').classList.contains('empty-state__text')).toBe(true);
        fireEvent.click(view.getByRole('button', { name: 'act' }));
      },
    );
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
