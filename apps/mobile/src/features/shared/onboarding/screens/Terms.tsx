// T051 (FR-AUTH-11, FR-127): the Terms, a modal route (`terms`) the onboarding form and the account
// tab both open. The body is served content with its version, not app copy (decided 2026-10-17):
// the API's `GET /terms?lang=` page (T039) in a WebView (owner's decision, 2026-10-20), so the text a
// person accepts is the one the server holds. Acceptance is the box on the profile step.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Banner, Button, NavHeader, Skeleton } from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { apiOrigin } from '../../../../lib/api';

export function Terms() {
  const t = useT();
  const locale = useLocale();
  const { color } = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader
        title={t('onboarding.terms.title')}
        back={{ kind: 'back', onPress: () => router.back() }}
      />
      {failed ? (
        <View style={{ paddingHorizontal: tokens.layout.gutter, gap: tokens.space['3'] }}>
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t('common.state.loadError')}
          </Banner>
          <Button
            label={t('common.action.retry')}
            variant="secondary"
            onPress={() => {
              setFailed(false);
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {loading ? (
            <View style={{ paddingHorizontal: tokens.layout.gutter, gap: tokens.space['2'] }}>
              <Skeleton shape="title" width="2/3" />
              <Skeleton shape="text" />
              <Skeleton shape="text" />
              <Skeleton shape="text" width="1/2" />
            </View>
          ) : null}
          <WebView
            key={attempt}
            source={{ uri: `${apiOrigin()}/terms?lang=${locale}` }}
            style={{ flex: 1, backgroundColor: color.bg }}
            onLoadEnd={() => setLoading(false)}
            onError={() => setFailed(true)}
            onHttpError={() => setFailed(true)}
          />
        </View>
      )}
    </View>
  );
}
