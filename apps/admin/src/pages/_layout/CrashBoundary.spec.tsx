// R3 T183: the panel's root error boundary (`docs/ARCHITECTURE.md` §12; Q-W (a)). A render error
// below it shows one full page in the panel's frame, «حدث خطأ» and «حدث خطأ غير متوقع.», Arabic
// first, with the existing «إعادة المحاولة», which renders the tree again; the error goes to the
// reporting module (lib/reporting.ts), which sends it only when Sentry is on.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectDesignRules } from '../../design/components/__tests__/harness';
import { type MessageKey, setLocale, translate } from '../../i18n';
import { reportCrash } from '../../lib/reporting';
import { CrashBoundary } from './CrashBoundary';

vi.mock('../../lib/reporting', () => ({ reportCrash: vi.fn() }));

let failing = true;
const thrown = new Error('render failed');

function Child() {
  if (failing) throw thrown;
  return <p>child</p>;
}

const boundary = () => (
  <CrashBoundary>
    <Child />
  </CrashBoundary>
);

beforeEach(() => {
  failing = true;
  // React writes every caught render error to the console in a test run; the run stays readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(reportCrash).mockClear();
  setLocale('ar');
});

describe('CrashBoundary', () => {
  it('shows the crash page on a child’s render error, Arabic first, in the panel’s frame', () => {
    for (const locale of ['ar', 'en'] as const) {
      setLocale(locale);
      const t = (key: MessageKey) => translate(locale, key);
      const view = render(boundary());
      const frame = view.container.querySelector('.console');
      expect(frame?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(screen.getByText(t('admin.common.crash.title'))).toBeTruthy();
      expect(screen.getByText(t('admin.common.crash.body'))).toBeTruthy();
      expect(screen.getByRole('button', { name: t('admin.common.action.retry') })).toBeTruthy();
      expect(screen.queryByText('child')).toBeNull();
      expectDesignRules(view.container);
      view.unmount();
    }
  });

  it('renders the child again on «إعادة المحاولة»', () => {
    render(boundary());
    failing = false;
    act(() => {
      fireEvent.click(
        screen.getByRole('button', { name: translate('ar', 'admin.common.action.retry') }),
      );
    });
    expect(screen.getByText('child')).toBeTruthy();
    expect(screen.queryByText(translate('ar', 'admin.common.crash.title'))).toBeNull();
  });

  it('reports the error with its component stack through the reporting module', () => {
    render(boundary());
    expect(reportCrash).toHaveBeenCalledTimes(1);
    const [error, componentStack] = vi.mocked(reportCrash).mock.calls[0] ?? [];
    expect(error).toBe(thrown);
    expect(componentStack).toEqual(expect.stringContaining('Child'));
  });
});
