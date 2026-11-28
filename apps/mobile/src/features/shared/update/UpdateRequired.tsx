// R3 T184 (SRS DEC-99, DEC-109; the note under T184, Q-W (a)): the one blocking screen a build below
// the server's floor sees. The root layout draws it in place of every route once any answer refuses
// the build `UPDATE_REQUIRED` (lib/api.tsx), so nothing else is reachable: no tab, no back, no
// screen behind it. Built as the crash screen is, full screen in the theme and the direction
// (Arabic first): «حدّث التطبيق», why, and one button opening the app's page on Google Play. The
// first release is Android only: on iOS the same screen carries no button (its store link waits for
// the iOS release).
import * as Linking from 'expo-linking';
import { Platform, View } from 'react-native';

import { EmptyState } from '../../../design/primitives';
import { useTheme } from '../../../design/theme';
import { tokens } from '../../../design/tokens';
import { useT } from '../../../i18n';

/** The app's package on Google Play (`apps/mobile/app.json`'s `android.package`). */
const PLAY_PACKAGE = 'com.ijazah.app';

/** The app's page on Google Play, which the button opens. */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

/** Opens the Play page; a phone that cannot open it stays on this screen, which says what to do. */
function openPlayStore(): void {
  void Linking.openURL(PLAY_STORE_URL).catch(() => undefined);
}

export function UpdateRequired() {
  const t = useT();
  const { color } = useTheme();
  const action =
    Platform.OS === 'android'
      ? { label: t('common.update.action'), onPress: openPlayStore }
      : undefined;
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
        icon={{ name: 'download' }}
        title={t('common.update.title')}
        text={t('common.update.body')}
        {...(action === undefined ? {} : { action })}
      />
    </View>
  );
}
