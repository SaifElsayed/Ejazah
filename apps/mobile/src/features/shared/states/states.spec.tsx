// T034 (FR-205): the generic states every tab root and list uses where the design draws none:
// loading rows, a danger banner with a retry, and the offline pattern. T138: `NotLoaded` in place of
// data not read yet and `OfflineNotice` over cached data, by the connection the query cache knows.
// T065 of specs/004-sessions: the failed read's error decides the banner's words, a `RATE_LIMITED`
// refusal saying when to try again (`genericErrorKey`, lib/error-message.ts).
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  colour,
  inBothDirections,
  nodesOf,
  renderIn,
  styleOf,
} from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { apiError } from '../__tests__/api-double';
import { LoadError, LoadingRows, NotLoaded, OfflineBanner, OfflineNotice } from './index';

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);

/** A `RATE_LIMITED` refusal, with the seconds until its window ends when `seconds` is given. */
const rateLimited = (seconds?: string) =>
  apiError(
    'RATE_LIMITED',
    seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }],
  );

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
      () => <LoadError error={new TypeError('Network request failed')} onRetry={retry} />,
      async (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'common.state.loadError'))).toBeTruthy();
        await fireEvent.press(
          screen.getByRole('button', { name: said(direction, 'common.action.retry') }),
        );
      },
    );
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('says when to try again after a RATE_LIMITED refusal that gives the time (T065)', async () => {
    await inBothDirections(
      () => <LoadError error={rateLimited('61')} onRetry={() => undefined} />,
      (_rendered, direction) => {
        expect(
          screen.getByText(said(direction, 'common.state.rateLimitedIn', { count: 2 })),
        ).toBeTruthy();
        expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
      },
    );
  });

  it('says to wait a little after a RATE_LIMITED refusal with no time (T065)', async () => {
    await inBothDirections(
      () => <LoadError error={rateLimited()} onRetry={() => undefined} />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'common.state.rateLimited'))).toBeTruthy();
        expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
      },
    );
  });

  it('keeps its own words for any other failure (T065)', async () => {
    await renderIn('rtl', <LoadError error={apiError('INTERNAL')} onRetry={() => undefined} />);
    expect(screen.getByText(said('rtl', 'common.state.loadError'))).toBeTruthy();
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

// T138: the states a screen shows for its data, by the connection the query cache knows.
describe('NotLoaded', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('draws the loading shapes while the data is on its way', async () => {
    await renderIn('rtl', <NotLoaded failed={false} onRetry={() => undefined} />);
    expect(screen.queryByText(said('rtl', 'common.state.offline'))).toBeNull();
    expect(screen.queryByText(said('rtl', 'common.state.loadError'))).toBeNull();
  });

  it('draws a screen’s own loading shapes in place of the rows', async () => {
    await renderIn(
      'rtl',
      <NotLoaded failed={false} onRetry={() => undefined} loading={<Text>جارٍ التحميل</Text>} />,
    );
    expect(screen.getByText('جارٍ التحميل')).toBeTruthy();
  });

  it('is the danger banner with a retry when the read failed', async () => {
    const retry = jest.fn();
    await renderIn('rtl', <NotLoaded failed onRetry={retry} />);
    expect(screen.getByText(said('rtl', 'common.state.loadError'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: said('rtl', 'common.action.retry') }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('hands the failed read’s error to the banner, which says when to try again (T065)', async () => {
    await renderIn('ltr', <NotLoaded failed error={rateLimited('31')} onRetry={() => undefined} />);
    expect(screen.getByText(said('ltr', 'common.state.rateLimitedIn', { count: 1 }))).toBeTruthy();
  });

  it('is the offline banner with a retry while there is no connection, failed or not', async () => {
    onlineManager.setOnline(false);
    const retry = jest.fn();
    await renderIn('rtl', <NotLoaded failed onRetry={retry} />);
    expect(screen.getByText(said('rtl', 'common.state.offline'))).toBeTruthy();
    expect(screen.queryByText(said('rtl', 'common.state.loadError'))).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: said('rtl', 'common.action.retry') }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('OfflineNotice', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('draws nothing while connected', async () => {
    await renderIn('rtl', <OfflineNotice onRetry={() => undefined} />);
    expect(screen.queryByText(said('rtl', 'common.state.offline'))).toBeNull();
  });

  it('draws the offline banner while there is no connection, and goes when it is back', async () => {
    onlineManager.setOnline(false);
    await renderIn('rtl', <OfflineNotice onRetry={() => undefined} />);
    expect(screen.getByText(said('rtl', 'common.state.offline'))).toBeTruthy();
    await act(async () => onlineManager.setOnline(true));
    expect(screen.queryByText(said('rtl', 'common.state.offline'))).toBeNull();
  });
});
