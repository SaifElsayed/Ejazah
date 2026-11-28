// R3 T183: the root's error boundary (`docs/ARCHITECTURE.md` §12; Q-W (a)). A render error below it
// shows one full screen, «حدث خطأ» and «حدث خطأ غير متوقع.», in the theme and the direction, Arabic
// first, with the existing «إعادة المحاولة», which renders the tree again; the error goes to the
// reporting module (lib/reporting.ts), which sends it only when Sentry is on.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { reportCrash } from '../../../lib/reporting';
import { CrashBoundary } from './CrashBoundary';

jest.mock('../../../lib/reporting', () => ({ reportCrash: jest.fn() }));

const ar = (key: MessageKey) => translate('ar', key);
const en = (key: MessageKey) => translate('en', key);

let failing = true;
const thrown = new Error('render failed');

function Child() {
  if (failing) throw thrown;
  return <Text>child</Text>;
}

const boundary = () => (
  <CrashBoundary>
    <Child />
  </CrashBoundary>
);

beforeEach(() => {
  failing = true;
  // React writes every caught render error to the console in a test run; the run stays readable.
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(reportCrash).mockClear();
});

describe('CrashBoundary', () => {
  it('shows the crash screen on a child’s render error, Arabic first, in the theme', async () => {
    await inBothDirections(boundary, (_rendered, direction) => {
      const t = direction === 'rtl' ? ar : en;
      expect(screen.getByText(t('common.crash.title'))).toBeTruthy();
      expect(screen.getByText(t('common.crash.body'))).toBeTruthy();
      expect(screen.getByText(t('common.action.retry'))).toBeTruthy();
      expect(screen.queryByText('child')).toBeNull();
    });
  });

  it('renders the child again on «إعادة المحاولة»', async () => {
    await renderIn('rtl', boundary());
    failing = false;
    await act(async () => {
      fireEvent.press(screen.getByText(ar('common.action.retry')));
    });
    expect(screen.getByText('child')).toBeTruthy();
    expect(screen.queryByText(ar('common.crash.title'))).toBeNull();
  });

  it('reports the error with its component stack through the reporting module', async () => {
    await renderIn('rtl', boundary());
    expect(reportCrash).toHaveBeenCalledTimes(1);
    const [error, componentStack] = jest.mocked(reportCrash).mock.calls[0] ?? [];
    expect(error).toBe(thrown);
    expect(componentStack).toEqual(expect.stringContaining('Child'));
  });
});
