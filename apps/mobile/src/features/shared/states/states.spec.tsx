// T034 (FR-205): the generic states every tab root and list uses where the design draws none:
// loading rows, a danger banner with a retry, and the offline pattern.
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import {
  colour,
  inBothDirections,
  nodesOf,
  styleOf,
} from '../../../design/primitives/__tests__/harness';
import { translate } from '../../../i18n';
import { LoadError, LoadingRows, OfflineBanner } from './index';

const said = (direction: 'rtl' | 'ltr', key: Parameters<typeof translate>[1]) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

describe('LoadingRows', () => {
  it('draws skeleton rows in place of a list', async () => {
    await inBothDirections(
      () => <LoadingRows rows={3} />,
      (rendered) => {
        const shapes = nodesOf(rendered).filter(
          (node) => styleOf(node)['backgroundColor'] === colour('light', 'skeleton'),
        );
        expect(shapes.length).toBeGreaterThanOrEqual(3);
      },
    );
  });
});

describe('LoadError', () => {
  it('is a danger banner that says the data did not load, with a retry', async () => {
    const retry = jest.fn();
    await inBothDirections(
      () => <LoadError onRetry={retry} />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'common.state.loadError'))).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'common.action.retry') }),
        );
      },
    );
    expect(retry).toHaveBeenCalledTimes(2);
  });
});

describe('OfflineBanner', () => {
  it('says there is no connection as a status, with a retry', async () => {
    const retry = jest.fn();
    await inBothDirections(
      () => <OfflineBanner onRetry={retry} />,
      async (rendered, direction) => {
        expect(screen.getByText(said(direction, 'common.state.offline'))).toBeTruthy();
        expect(
          nodesOf(rendered).some((node) => node.props['accessibilityLiveRegion'] === 'polite'),
        ).toBe(true);
        await fireEvent.press(
          screen.getByRole('link', { name: said(direction, 'common.action.retry') }),
        );
      },
    );
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
