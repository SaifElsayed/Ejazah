// T036: Steps, Timeline, Meter (docs/design/components.md, "Primitives").
import { describe, expect, it } from 'vitest';

import { inBothDirections } from './__tests__/harness';
import { Meter, Steps, Timeline } from './index';

describe('Steps', () => {
  it('marks the steps done before the current one, and the current one', () => {
    inBothDirections(
      () => <Steps steps={['a', 'b', 'c']} current={1} />,
      ({ frame }) => {
        const items = [...frame.querySelectorAll('ol.steps > .steps__item')];
        expect(items.map((item) => [...item.classList])).toEqual([
          ['steps__item', 'steps__item--done'],
          ['steps__item', 'steps__item--current'],
          ['steps__item'],
        ]);
        expect(items[1]?.getAttribute('aria-current')).toBe('step');
        expect(items[0]?.querySelector('.steps__bar')).not.toBeNull();
      },
    );
  });
});

describe('Timeline', () => {
  it('draws each stage with its marker, the line between stages, and the pending ones muted', () => {
    inBothDirections(
      () => (
        <Timeline
          items={[
            { title: 'a', meta: 'meta', state: 'done' },
            { title: 'b', state: 'current' },
            { title: 'c', state: 'pending' },
          ]}
        />
      ),
      ({ frame }) => {
        const items = [...frame.querySelectorAll('ol.timeline > .timeline__item')];
        expect(items.map((item) => item.classList.contains('timeline__item--pending'))).toEqual([
          false,
          false,
          true,
        ]);
        const markers = items.map((item) => item.querySelector('.timeline__marker')?.className);
        expect(markers).toEqual([
          'timeline__marker timeline__marker--done',
          'timeline__marker timeline__marker--current',
          'timeline__marker',
        ]);
        expect(items[0]?.querySelector('.timeline__line--done')).not.toBeNull();
        expect(items[2]?.querySelector('.timeline__line')).toBeNull();
        expect(items[0]?.querySelector('.timeline__meta')?.textContent).toBe('meta');
      },
    );
  });
});

describe('Meter', () => {
  it('fills to its value and marks the threshold from the start, low below it', () => {
    inBothDirections(
      () => (
        <>
          <Meter value={73} threshold={70} accessibilityLabel="above" />
          <Meter value={40} threshold={70} accessibilityLabel="below" />
        </>
      ),
      ({ view }) => {
        const above = view.getByRole('img', { name: 'above' });
        expect(above.classList.contains('meter')).toBe(true);
        const fill = above.querySelector<HTMLElement>('.meter__fill');
        expect(fill?.style.width).toBe('73%');
        expect(fill?.classList.contains('meter__fill--low')).toBe(false);
        expect(above.querySelector<HTMLElement>('.meter__mark')?.style.insetInlineStart).toBe(
          '70%',
        );
        const below = view.getByRole('img', { name: 'below' });
        expect(below.querySelector('.meter__fill')?.classList.contains('meter__fill--low')).toBe(
          true,
        );
      },
    );
  });

  it('keeps a value outside 0 to 100 inside the bar', () => {
    inBothDirections(
      () => <Meter value={140} threshold={-5} accessibilityLabel="meter" />,
      ({ view }) => {
        const meter = view.getByRole('img', { name: 'meter' });
        expect(meter.querySelector<HTMLElement>('.meter__fill')?.style.width).toBe('100%');
        expect(meter.querySelector<HTMLElement>('.meter__mark')?.style.insetInlineStart).toBe('0%');
      },
    );
  });
});
