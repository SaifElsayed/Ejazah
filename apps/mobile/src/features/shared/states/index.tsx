// T034 (FR-205): the states the design does not draw, as screens.md's states tables assign them:
// skeleton rows while a list loads, a danger banner with a retry when it fails, and the offline
// pattern (a warning banner announced as a status, with a retry) on every tab root and list.
// T138: the screens reach them through `NotLoaded`, in place of data not read yet, and
// `OfflineNotice`, over cached data, by the connection the query cache knows (lib/online.ts).
// T065 of specs/004-sessions: the danger banner takes the failed read's error, so a `RATE_LIMITED`
// refusal says when to try again (`genericErrorKey`, lib/error-message.ts).
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Banner, Button, Skeleton, TextLink } from '../../../design/primitives';
import { tokens } from '../../../design/tokens';
import { useT } from '../../../i18n';
import { genericErrorKey } from '../../../lib/error-message';
import { useOnline } from '../../../lib/online';

/** Skeleton rows in place of a list: an avatar, a title and a line each. */
export function LoadingRows({ rows = 3 }: { readonly rows?: number }) {
  return (
    <View style={{ gap: tokens.space['4'] }}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}
        >
          <Skeleton shape="avatar" />
          <View style={{ flex: 1, gap: tokens.space['2'] }}>
            <Skeleton shape="title" width="2/3" />
            <Skeleton shape="text" width="1/3" />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The data did not load: a danger banner and the one next step. */
export function LoadError({
  error,
  onRetry,
}: {
  /** The failed read's error. */
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const t = useT();
  const { key, values } = genericErrorKey(error, 'common.state.loadError');
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Banner icon={{ name: 'triangle-alert' }} tone="danger">
        {t(key, values)}
      </Banner>
      <Button label={t('common.action.retry')} variant="secondary" size="md" onPress={onRetry} />
    </View>
  );
}

/** No connection (`MainOffline`): announced as a status; the cached content stays below it. */
export function OfflineBanner({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: tokens.space['1'] }}>
      <Banner icon={{ name: 'wifi-off' }} tone="warning">
        {t('common.state.offline')}
      </Banner>
      <TextLink label={t('common.action.retry')} onPress={onRetry} />
    </View>
  );
}

/**
 * In place of data not read yet: with no connection the offline banner (the read waits for one),
 * after a failed read the danger banner, else the loading shapes (the screen's own, or rows).
 */
export function NotLoaded({
  failed,
  error,
  onRetry,
  loading = <LoadingRows />,
}: {
  readonly failed: boolean;
  /** The failed read's error, handed to the danger banner. */
  readonly error?: unknown;
  readonly onRetry: () => void;
  readonly loading?: ReactNode;
}) {
  const online = useOnline();
  if (!online) return <OfflineBanner onRetry={onRetry} />;
  if (failed) return <LoadError error={error} onRetry={onRetry} />;
  return loading;
}

/**
 * Over cached data on a tab root or a list (the `MainOffline` pattern): the offline banner while
 * there is no connection, nothing while there is one.
 */
export function OfflineNotice({ onRetry }: { readonly onRetry: () => void }) {
  return useOnline() ? null : <OfflineBanner onRetry={onRetry} />;
}
