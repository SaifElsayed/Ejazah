// T032: Steps and Timeline (R-MOBILE-4/5), in both directions.
import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { tokens } from '../tokens';
import { colour, inBothDirections, nodesOf, styleOf, unmarked } from './__tests__/harness';
import { Steps, Timeline } from './index';

describe('Steps', () => {
  it('draws one bar per step, primary up to the current, and announces where the user is', async () => {
    await inBothDirections(
      () => <Steps steps={['المواد', 'الوثائق', 'الإجازات']} current={1} />,
      (rendered, direction) => {
        const bars = nodesOf(rendered).filter(
          (node) => styleOf(node)['height'] === tokens.size['steps-bar'],
        );
        expect(bars.map((bar) => styleOf(bar)['backgroundColor'])).toEqual([
          colour('light', 'primary'),
          colour('light', 'primary'),
          colour('light', 'border-strong'),
        ]);
        expect(styleOf(screen.getByText('الوثائق'))['fontWeight']).toBe(tokens.font.weight.bold);
        const name = direction === 'rtl' ? 'الخطوة 2 من 3' : 'Step 2 of 3';
        expect(screen.getByLabelText(name, { normalizer: unmarked })).toBeTruthy();
      },
    );
  });
});

describe('Timeline', () => {
  it('marks each stage done, current or pending, joined by a line', async () => {
    await inBothDirections(
      () => (
        <Timeline
          items={[
            { title: 'أُرسل الطلب', meta: '15 أكتوبر', state: 'done' },
            { title: 'قيد المراجعة', state: 'current' },
            { title: 'القرار', state: 'pending' },
          ]}
        />
      ),
      (rendered) => {
        const markers = nodesOf(rendered).filter(
          (node) => styleOf(node)['width'] === tokens.media.xs,
        );
        expect(markers.map((marker) => styleOf(marker)['backgroundColor'])).toEqual([
          colour('light', 'primary'),
          colour('light', 'primary-subtle'),
          colour('light', 'bg'),
        ]);
        expect(styleOf(screen.getByText('القرار'))['color']).toBe(colour('light', 'text-muted'));
        expect(styleOf(screen.getByText('15 أكتوبر'))['fontSize']).toBe(tokens.text.caption.size);
        const lines = nodesOf(rendered).filter(
          (node) => styleOf(node)['width'] === tokens.borderWidth.selected,
        );
        // A line joins each stage to the next; the last has none.
        expect(lines).toHaveLength(2);
      },
    );
  });
});
