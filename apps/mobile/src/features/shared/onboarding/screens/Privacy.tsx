// R3 T185 (with `specs/004-sessions/tasks.md` T078): the privacy policy, a modal route (`privacy`)
// the sign-up's Terms sentence and the account tab both open. As the Terms (`Terms.tsx`), the body
// is served content, not app copy: the API's `GET /privacy?lang=` page in a WebView, so the text a
// person agrees to is the one the server holds, asked for in the app's scheme (`&theme=`, T105).
// Agreement is the one box on the profile step, whose sentence names both pages.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Banner, Button, NavHeader, Skeleton } from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { apiOrigin } from '../../../../lib/api';

export function Privacy() {
  const t = useT();
  const locale = useLocale();
  const { color, scheme } = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <NavHeader
        title={t('onboarding.privacy.title')}
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
            source={{ uri: `${apiOrigin()}/privacy?lang=${locale}&theme=${scheme}` }}
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
