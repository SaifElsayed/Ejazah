// T034 (FR-202): the student's home before the first enrollment (`StudentHomeEmpty`), drawn with
// no data path: the brand, the first step with its three lines, and the way to discovery. The
// greeting by name and the subject chips are data and arrive with the home in Phase 2.
import { router } from 'expo-router';
import { View } from 'react-native';

import { AppHeader, Button, Card, Text } from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { TabScreen } from '../../../shared/screen';

const STEPS: readonly MessageKey[] = [
  'student.home.empty.step1',
  'student.home.empty.step2',
  'student.home.empty.step3',
];

export function StudentHomeEmpty() {
  const t = useT();
  const format = useFormatters();
  const { color } = useTheme();
  return (
    <TabScreen header={<AppHeader brand />}>
      <Card variant="hero">
        <Text variant="callout" tone="muted">
          {t('student.home.empty.kicker')}
        </Text>
        <Text variant="title-2">{t('student.home.empty.title')}</Text>
        <View style={{ gap: tokens.space['2'] }}>
          {STEPS.map((step, index) => (
            <View
              key={step}
              style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}
            >
              {/* The first step is the one to take (`.timeline__marker--done`), the rest wait. */}
              <View
                style={{
                  width: tokens.media.xs,
                  height: tokens.media.xs,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: tokens.radius.full,
                  borderWidth: tokens.borderWidth.hairline,
                  borderColor: index === 0 ? color.primary : color['border-strong'],
                  backgroundColor: index === 0 ? color.primary : color.bg,
                }}
              >
                <Text variant="caption" weight="bold" tone={index === 0 ? 'on-primary' : 'muted'}>
                  {format.number(index + 1)}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text>{t(step)}</Text>
              </View>
            </View>
          ))}
        </View>
        <Button
          label={t('student.home.empty.findTeacher')}
          layout="block"
          onPress={() => router.navigate('/(student)/(tabs)/discovery')}
        />
      </Card>
    </TabScreen>
  );
}
