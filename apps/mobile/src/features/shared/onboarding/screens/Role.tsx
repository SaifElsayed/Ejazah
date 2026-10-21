// T051 (FR-AUTH-2 as ADR 0016 D1 rewrote it, FR-AUTH-12): the first step. One role per account,
// chosen once with no switcher, so nothing is chosen for the person: «التالي» waits for a choice.
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';

import {
  ActionBar,
  Button,
  Choice,
  IconTile,
  PageIntro,
  Steps,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { BackBar, StackScreen } from '../../screen';
import { updateDraft, useDraft } from '../draft';

const ROLES = [
  {
    role: 'student',
    icon: 'book',
    title: 'onboarding.role.student',
    hint: 'onboarding.role.studentHint',
  },
  {
    role: 'teacher',
    icon: 'award',
    title: 'onboarding.role.teacher',
    hint: 'onboarding.role.teacherHint',
  },
] as const satisfies readonly {
  role: 'student' | 'teacher';
  icon: 'book' | 'award';
  title: MessageKey;
  hint: MessageKey;
}[];

/** The two steps of the onboarding, as the step indicator names them. */
export function useOnboardingSteps(): readonly string[] {
  const t = useT();
  return [t('onboarding.role.title'), t('onboarding.profile.title')];
}

export function Role() {
  const t = useT();
  const draft = useDraft();
  const steps = useOnboardingSteps();
  if (draft === null) return <Redirect href="/(auth)/welcome" />;
  return (
    <StackScreen
      header={
        <View style={{ gap: tokens.space['3'], paddingBottom: tokens.space['2'] }}>
          <BackBar onPress={() => router.back()} />
          <View style={{ paddingHorizontal: tokens.layout.gutter }}>
            <Steps steps={steps} current={0} />
          </View>
        </View>
      }
      footer={
        <ActionBar>
          <Button
            label={t('common.action.next')}
            layout="block"
            disabled={draft.role === undefined}
            onPress={() => router.push('/(auth)/profile')}
          />
        </ActionBar>
      }
    >
      <PageIntro title={t('onboarding.role.title')} lede={t('onboarding.role.lede')} />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('onboarding.role.a11y.role')}
        style={{ gap: tokens.space['3'] }}
      >
        {ROLES.map(({ role, icon, title, hint }) => {
          const selected = draft.role === role;
          return (
            <Choice
              key={role}
              selected={selected}
              onPress={() => updateDraft({ role })}
              label={
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}
                >
                  <IconTile icon={{ name: icon }} tone={selected ? 'primary' : 'default'} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text weight="bold">{t(title)}</Text>
                    <Text variant="caption" tone="muted">
                      {t(hint)}
                    </Text>
                  </View>
                </View>
              }
            />
          );
        })}
      </View>
    </StackScreen>
  );
}
