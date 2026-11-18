// 003:T109 (SRS DEC-87, ADR 0025 D7; Q-B3 (a)): «نسخة تجريبية» over every screen while the server's
// payment mode is `test`, read from `platform.publicConfig`; nothing in `live`, and nothing while the
// mode is unread. Drawn by the root layout above the routes, below the status bar, and it never
// takes a touch.
//
// The mode is held here, not in the query cache: the root layout clears the cache when a session
// ends (T136), which would drop the answer and the strip with it.
//
// 003:T115 (PR #144's review, round 1, finding 3 (b)): the mode is read again each time the app
// comes back to the foreground (AppState `active`) and each time the connection returns, so a
// server moved to `live` takes the strip away from a running app. Each read asks the server:
// `client.publicConfig()` keeps its first answer for the launch. A read that fails keeps the mode
// last read.
import { type PublicConfig, publicConfigOutput } from '@ijazah/contracts';
import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '../../../design/primitives';
import { useT } from '../../../i18n';
import { useApi } from '../../../lib/api';

export function TestModeStrip() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { client } = useApi();
  const [mode, setMode] = useState<PublicConfig['paymentMode'] | undefined>(undefined);
  useEffect(() => {
    let unmounted = false;
    const read = () => {
      client.api.platform.publicConfig
        .query()
        .then((answer) => publicConfigOutput.parse(answer).paymentMode)
        .then(
          (paymentMode) => {
            if (!unmounted) setMode(paymentMode);
          },
          () => undefined,
        );
    };
    read();
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) read();
    });
    const foreground = AppState.addEventListener('change', (status) => {
      if (status === 'active') read();
    });
    return () => {
      unmounted = true;
      unsubscribe();
      foreground.remove();
    };
  }, [client]);
  if (mode !== 'test') return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top,
        start: 0,
        end: 0,
        flexDirection: 'row',
        justifyContent: 'center',
      }}
    >
      <Badge label={t('money.testMode.label')} tone="warning" />
    </View>
  );
}
