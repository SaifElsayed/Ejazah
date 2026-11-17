// 003:T109 (SRS DEC-87, ADR 0025 D7; Q-B3 (a)): «نسخة تجريبية» over every screen while the server's
// payment mode is `test`, read from `platform.publicConfig`; nothing in `live`, and nothing while the
// mode is unread. Drawn by the root layout above the routes, below the status bar, and it never
// takes a touch.
//
// The mode is held here, not in the query cache: the root layout clears the cache when a session
// ends (T136), which would drop the answer and the strip with it. A read that fails is asked again
// when the connection returns.
import type { PublicConfig } from '@ijazah/contracts';
import { onlineManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
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
    let known = false;
    let unmounted = false;
    const read = () => {
      if (known) return;
      client.publicConfig().then(
        (config) => {
          if (unmounted) return;
          known = true;
          setMode(config.paymentMode);
        },
        () => undefined,
      );
    };
    read();
    const unsubscribe = onlineManager.subscribe((online) => {
      if (online) read();
    });
    return () => {
      unmounted = true;
      unsubscribe();
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
