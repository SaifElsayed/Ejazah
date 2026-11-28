// R3 T183: the root's error boundary (`docs/ARCHITECTURE.md` §12; Q-W (a)). A render error anywhere
// below it, instead of a blank or a closed app, shows one full screen in the theme and the
// direction (Arabic first): «حدث خطأ», «حدث خطأ غير متوقع.» and the existing «إعادة المحاولة»,
// which renders the tree again. The error goes to the reporting module (lib/reporting.ts), which
// sends it only when Sentry is on; nothing here writes it to the console.
//
// The root layout places it inside the theme and direction providers, so this screen has both, and
// around the query cache and the API client, so an error in either is caught too.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';

import { EmptyState } from '../../../design/primitives';
import { useTheme } from '../../../design/theme';
import { tokens } from '../../../design/tokens';
import { useT } from '../../../i18n';
import { reportCrash } from '../../../lib/reporting';

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
    return this.state.failed ? <CrashScreen onRetry={this.retry} /> : this.props.children;
  }
}

function CrashScreen({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  const { color } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: tokens.layout.gutter,
        backgroundColor: color.bg,
      }}
    >
      <EmptyState
        icon={{ name: 'alert-circle' }}
        title={t('common.crash.title')}
        text={t('common.crash.body')}
        action={{ label: t('common.action.retry'), onPress: onRetry }}
      />
    </View>
  );
}
