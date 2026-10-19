// T034 (FR-205): the states the design does not draw, as screens.md's states tables assign them:
// skeleton rows while a list loads, a danger banner with a retry when it fails, and the offline
// pattern (a warning banner announced as a status, with a retry) on every tab root and list.
import { View } from 'react-native';

import { Banner, Button, Skeleton, TextLink } from '../../../design/primitives';
import { tokens } from '../../../design/tokens';
import { useT } from '../../../i18n';

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
export function LoadError({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Banner icon={{ name: 'triangle-alert' }} tone="danger">
        {t('common.state.loadError')}
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
