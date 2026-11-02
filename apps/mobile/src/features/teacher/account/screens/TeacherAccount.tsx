// T052 (FR-PROFILE-6, FR-AUTH-5, FR-LOC-3, FR-AUTH-10, FR-GENDER-5, FR-AUTH-11, FR-AUTH-7): the
// teacher's account tab (TeacherAccount): sign-out in the header, the avatar and name with the
// approved badge, and the settings the student's tab has. The teaching list and the delete row are
// added with their screens (owner's decision, 2026-10-20): «إجازاتي» since B11b (T059), with the
// count waiting for review from `teacher.credentials.list`; «حساب الاستلام» since B15 (T078), for an
// approved teacher, to the payout's state, its badge each state of `teacher.payout.get` as
// PayoutSetup reads it (T115: `account.me` reads a rejection with no reason as pending); the danger row «حذف الحساب» since B16 (T084), after the settings, to
// the deletion; the signature and the rating with their phases; the notifications with theirs.
// T158: «الملف العام» leads the teaching list to the public profile, where the display name is
// edited; the board's hint names the subjects, which the profile does not edit, so it is left out
// (R-HONEST; the key stays in the catalogue).
import type { PayoutState } from '@ijazah/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  AppHeader,
  Avatar,
  Badge,
  Card,
  Icon,
  IconButton,
  List,
  ListRow,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { AccountLoading, AccountSettings, initialsOf, SignOutSheet } from '../../../shared/account';
import { TabScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useCredentials } from '../../credentials';
import { PAYOUT_ROUTE, usePayout } from '../../payout';
import { PROFILE_ROUTE } from '../../profile';
import { DELETE_ACCOUNT_TEACHER_ROUTE } from '../navigation';

/** The payout row's badge for each state; none while no account is configured (T115). */
const PAYOUT_BADGE = {
  not_configured: undefined,
  pending_verification: { label: 'status.payout.verifying', tone: 'warning' },
  verified: { label: 'status.payout.verified', tone: 'success' },
  rejected: { label: 'status.payout.rejected', tone: 'danger' },
} as const satisfies Record<
  PayoutState,
  { readonly label: MessageKey; readonly tone: 'warning' | 'success' | 'danger' } | undefined
>;

/** «حساب الاستلام», for an approved teacher, with the state `teacher.payout.get` answers. */
function PayoutRow() {
  const t = useT();
  const payout = usePayout();
  const badge = payout.data === undefined ? undefined : PAYOUT_BADGE[payout.data.state];
  return (
    <ListRow
      label={t('teacher.account.payout')}
      {...(badge === undefined
        ? {}
        : { trailing: <Badge label={t(badge.label)} tone={badge.tone} /> })}
      onPress={() => router.push(PAYOUT_ROUTE)}
    />
  );
}

export function TeacherAccount() {
  const t = useT();
  const me = useMe();
  const credentials = useCredentials();
  const [signingOut, setSigningOut] = useState(false);
  const account = me.data;
  const waiting = (credentials.data ?? []).filter(({ status }) => status === 'pending').length;
  return (
    <TabScreen
      header={
        <AppHeader
          title={t('teacher.account.title')}
          actions={
            account === undefined ? undefined : (
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
      {account === undefined ? (
        <NotLoaded
          failed={me.isError}
          onRetry={() => void me.refetch()}
          loading={<AccountLoading />}
        />
      ) : (
        <>
          <OfflineNotice
            onRetry={() => {
              void me.refetch();
              void credentials.refetch();
            }}
          />
          <Card variant="row">
            <Avatar
              initials={initialsOf(account.displayName)}
              size="lg"
              {...(account.photoUrl === undefined ? {} : { imageUri: account.photoUrl })}
            />
            <View style={{ flex: 1, minWidth: 0, gap: tokens.space['1'] }}>
              <Text variant="headline">{account.displayName}</Text>
              {account.teacher?.verificationStatus === 'approved' ? (
                <View style={{ alignSelf: 'flex-start' }}>
                  <Badge label={t('status.application.approved')} tone="success" />
                </View>
              ) : null}
            </View>
          </Card>
          <List header={t('teacher.account.teaching')}>
            <ListRow
              label={t('teacher.account.profile')}
              onPress={() => router.push(PROFILE_ROUTE)}
            />
            <ListRow
              label={t('teacher.account.credentials')}
              {...(waiting === 0
                ? {}
                : {
                    trailing: (
                      <Badge
                        label={t('teacher.account.credentialsPending', { count: waiting })}
                        tone="neutral"
                      />
                    ),
                  })}
              onPress={() => router.push('/(teacher)/credentials')}
            />
            {account.teacher?.verificationStatus === 'approved' ? <PayoutRow /> : null}
          </List>
          <AccountSettings me={account} />
          <List>
            <ListRow
              label={t('teacher.account.deleteAccount')}
              tone="danger"
              leading={<Icon name="trash" tone="danger" />}
              onPress={() => router.push(DELETE_ACCOUNT_TEACHER_ROUTE)}
            />
          </List>
          <SignOutSheet
            open={signingOut}
            method={account.signInMethod}
            onClose={() => setSigningOut(false)}
          />
        </>
      )}
    </TabScreen>
  );
}
