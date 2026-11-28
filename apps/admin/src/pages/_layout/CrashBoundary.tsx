// R3 T183: the panel's root error boundary (`docs/ARCHITECTURE.md` §12; Q-W (a)). A render error
// anywhere below it, instead of a blank tab, shows one full page in the panel's frame (`Console`:
// the scheme, the direction and the language, Arabic first): «حدث خطأ», «حدث خطأ غير متوقع.» and
// the existing «إعادة المحاولة», which renders the tree again. The error goes to the reporting
// module (lib/reporting.ts), which sends it only when Sentry is on; nothing here writes it to the
// console.
//
// The entry (main.tsx) places it around `<App>`: nothing above the App provides the language or the
// theme (both are the document's and `Console`'s), so the page draws its own frame.
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Console, EmptyState } from '../../design/components';
import { useT } from '../../i18n';
import { reportCrash } from '../../lib/reporting';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

export class CrashBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportCrash(error, info.componentStack);
  }

  private readonly retry = () => {
    this.setState({ failed: false });
  };

  override render() {
    return this.state.failed ? <CrashPage onRetry={this.retry} /> : this.props.children;
  }
}

function CrashPage({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  return (
    <Console>
      <main className="page">
        <div className="grow row row--center items-center">
          <EmptyState
            icon={{ name: 'alert-circle' }}
            title={t('admin.common.crash.title')}
            text={t('admin.common.crash.body')}
            action={{ label: t('admin.common.action.retry'), onPress: onRetry }}
          />
        </div>
      </main>
    </Console>
  );
}
