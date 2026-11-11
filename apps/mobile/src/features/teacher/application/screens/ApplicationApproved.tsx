// T058 (FR-152, FR-VERIFY-7, FR-PAYG-13): the approved state of the status screen, shown once
// after the approval. Owner's decisions at the conflict check of B11b (note under T058): the three
// next steps are drawn; the packages step opens the packages tab (its locked state exists since
// T034); the public profile (Phase 2) is told, not linked, until its screen exists. Since B15
// (T078, FR-190) the payout step and the primary «إعداد حساب الاستلام» open the payout, which
// immediately follows the approval; the ghost «إكمال الملف العام أولًا» waits for its screen. Each
// marks the screen shown (`markApprovedShown`) before it leaves.
import { type Href, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  IconTile,
  List,
  ListRow,
  PageIntro,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { PAYOUT_ROUTE } from '../../payout';
import { useApplicationActions } from '../api';

const STEPS = [
  {
    title: 'teacher.application.approved.payout',
    hint: 'teacher.application.approved.payoutHint',
    route: PAYOUT_ROUTE,
  },
  {
    title: 'teacher.application.approved.profile',
    hint: 'teacher.application.approved.profileHint',
  },
  {
    title: 'teacher.application.approved.packages',
    hint: 'teacher.application.approved.packagesHint',
    route: '/(teacher)/(tabs)/packages',
  },
] as const satisfies readonly { title: MessageKey; hint: MessageKey; route?: Href }[];

export function ApplicationApproved() {
  const t = useT();
  const format = useFormatters();
  const actions = useApplicationActions();
  const [leaving, setLeaving] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);

  async function leaveFor(route: Href): Promise<void> {
    setLeaving(true);
    setFailure(null);
    try {
      await actions.markApprovedShown();
      router.replace(route);
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <StackScreen
      header={<View style={{ height: tokens.space['6'] }} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.application.approved.setupPayout')}
            layout="block"
            loading={leaving}
            disabled={leaving}
            onPress={() => void leaveFor(PAYOUT_ROUTE)}
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'circle-check' }} tone="success" size="xl" round />
      <PageIntro
        title={t('teacher.application.approved.title')}
        lede={t('teacher.application.approved.lede')}
      />
      <View accessibilityLabel={t('teacher.application.approved.a11y.steps')}>
        <List>
          {STEPS.map((step, index) => (
            <ListRow
              key={step.title}
              leading={
                <Text variant="headline" tone="primary">
                  {format.number(index + 1)}
                </Text>
              }
              label={
                <View style={{ gap: tokens.space['1'] }}>
                  <Text variant="headline">{t(step.title)}</Text>
                  <Text variant="caption" tone="muted">
                    {t(step.hint)}
                  </Text>
                </View>
              }
              {...('route' in step ? { onPress: () => void leaveFor(step.route) } : {})}
            />
          ))}
        </List>
      </View>
      {failure !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      ) : null}
    </StackScreen>
  );
}
