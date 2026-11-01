// T058 (FR-152, FR-AUTH-9, FR-VERIFY-3 to FR-VERIFY-6): the application's standing on one screen,
// in each drawn state, as `teacher.application.get` answers it. In review: received, and the
// timeline (sent with its date and subject count, the review, the verification call, the decision);
// a document asked for adds the warning card that opens the request. Rejected: the reviewer's note
// with its date and the way to reapply (FR-155). Approved: `ApplicationApproved`, shown once
// (`approvedShown`), then the tabs. With no application yet, the first step; a banned account never
// reaches this screen (the guard lands it on the restricted screen, FR-137). T074: the identity
// request's card comes first while the account is under one.
//
// T098 (App Store 5.1.1(v)): with the tabs closed, «حذف الحساب» at the foot of each answered state
// (in review, a document asked for, rejected), the outlined danger button, opens the teacher's
// deletion (T084); the approved screen leads to the tabs, whose account has its own.
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppHeader,
  Badge,
  Button,
  Card,
  IconButton,
  IconTile,
  Skeleton,
  Text,
  Timeline,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { IdentityRequestCard, SignOutSheet } from '../../../shared/account';
import { TabScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { DELETE_ACCOUNT_TEACHER_ROUTE } from '../../account/navigation';
import { useApplicationStatus } from '../api';
import { startApplication } from '../draft';
import { ApplicationApproved } from './ApplicationApproved';

/** An instant as the status screen dates it: the full date in the account's zone. */
export function useApplicationDate(): (instant: string | undefined) => string | undefined {
  const me = useMe();
  const format = useFormatters();
  const zone = me.data?.timezone;
  return (instant) =>
    instant === undefined || zone === undefined ? undefined : format.fullDate(instant, zone);
}

export function ApplicationStatus() {
  const t = useT();
  const me = useMe();
  const application = useApplicationStatus();
  const dated = useApplicationDate();
  const [signingOut, setSigningOut] = useState(false);
  const answer = application.data;

  if (answer?.status === 'not_started') return <Redirect href="/(teacher)/application/subjects" />;
  if (answer?.status === 'approved') return <ApplicationApproved />;

  return (
    <TabScreen
      header={
        <AppHeader
          title={t('teacher.application.status.title')}
          actions={
            me.data === undefined ? undefined : (
              <IconButton
                icon={{ name: 'log-out' }}
                accessibilityLabel={t('common.action.signOut')}
                onPress={() => setSigningOut(true)}
              />
            )
          }
        />
      }
    >
      {answer === undefined ? null : <OfflineNotice onRetry={() => void application.refetch()} />}
      <IdentityRequestCard />
      {answer === undefined ? (
        <NotLoaded
          failed={application.isError}
          onRetry={() => void application.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : answer.status === 'rejected' ? (
        <View style={{ gap: tokens.space['5'] }}>
          <Card variant="hero">
            <IconTile icon={{ name: 'circle-x' }} tone="danger" size="lg" />
            <Text variant="title-2">{t('teacher.application.rejected.heading')}</Text>
          </Card>
          <Card>
            <Text variant="headline">{t('teacher.application.rejected.noteTitle')}</Text>
            {answer.note === undefined ? null : <Text>{answer.note}</Text>}
            <Text variant="caption" tone="muted">
              {dated(answer.decidedAt) === undefined
                ? t('common.reviewTeam.from')
                : t('common.reviewTeam.fromOn', { date: dated(answer.decidedAt) ?? '' })}
            </Text>
          </Card>
          <Button
            label={t('teacher.application.rejected.applyAgain')}
            layout="block"
            onPress={() => {
              startApplication('reapply');
              router.push('/(teacher)/application/subjects');
            }}
          />
        </View>
      ) : (
        <View style={{ gap: tokens.space['5'] }}>
          <Card variant="hero">
            <View style={{ alignSelf: 'flex-start' }}>
              <Badge label={t('status.application.pending')} tone="neutral" />
            </View>
            <Text variant="title-2">{t('teacher.application.status.receivedTitle')}</Text>
            <Text tone="muted">{t('teacher.application.status.receivedText')}</Text>
          </Card>
          {answer.status === 'needs_document' ? (
            <Card variant="warning" onPress={() => router.push('/(teacher)/application/more-info')}>
              <Text variant="headline">{t('teacher.application.status.moreInfoCard')}</Text>
              {dated(answer.decidedAt) === undefined ? null : (
                <Text variant="caption" tone="muted">
                  {t('common.reviewTeam.fromOn', { date: dated(answer.decidedAt) ?? '' })}
                </Text>
              )}
            </Card>
          ) : null}
          <View accessibilityLabel={t('teacher.application.status.timeline.a11y')}>
            <Timeline
              items={[
                {
                  title: t('teacher.application.status.timeline.submitted'),
                  ...(answer.submittedAt === undefined || answer.subjectCount === undefined
                    ? {}
                    : {
                        meta: t('teacher.application.status.timeline.submittedMeta', {
                          date: dated(answer.submittedAt) ?? '',
                          count: answer.subjectCount,
                        }),
                      }),
                  state: 'done',
                },
                {
                  title: t('teacher.application.status.timeline.review'),
                  state: answer.callRecorded ? 'done' : 'current',
                },
                {
                  title: t('teacher.application.status.timeline.call'),
                  ...(answer.callRecorded
                    ? {}
                    : { meta: t('teacher.application.status.timeline.callMeta') }),
                  state: answer.callRecorded ? 'done' : 'pending',
                },
                {
                  title: t('teacher.application.status.timeline.decision'),
                  state: answer.callRecorded ? 'current' : 'pending',
                },
              ]}
            />
          </View>
        </View>
      )}
      {answer === undefined ? null : <DeleteAccountAction />}
      {me.data === undefined ? null : (
        <SignOutSheet
          open={signingOut}
          method={me.data.signInMethod}
          onClose={() => setSigningOut(false)}
        />
      )}
    </TabScreen>
  );
}

/** «حذف الحساب» for an applicant, whose tabs and account are closed (T098). */
export function DeleteAccountAction() {
  const t = useT();
  return (
    <Button
      label={t('teacher.account.deleteAccount')}
      variant="danger"
      size="md"
      layout="block"
      onPress={() => router.push(DELETE_ACCOUNT_TEACHER_ROUTE)}
    />
  );
}
