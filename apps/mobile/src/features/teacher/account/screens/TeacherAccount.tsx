// T052 (FR-PROFILE-6, FR-AUTH-5, FR-LOC-3, FR-AUTH-10, FR-GENDER-5, FR-AUTH-11, FR-AUTH-7): the
// teacher's account tab (TeacherAccount): sign-out in the header, the avatar and name with the
// approved badge, and the settings the student's tab has. The teaching list and the delete row are
// added with their screens (owner's decision, 2026-10-20): «إجازاتي» since B11b (T059), with the
// count waiting for review from `teacher.credentials.list`; «حساب الاستلام» since B15 (T078), for an
// approved teacher, to the payout's state, with «موثّق» once `account.me` says verified (the only
// badge drawn, open-items 18); the danger row «حذف الحساب» since B16 (T084), after the settings, to
// the deletion; the public profile, the signature and the rating with their phases; the
// notifications with theirs.
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
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import {
  AccountFailed,
  AccountLoading,
  AccountSettings,
  initialsOf,
  SignOutSheet,
} from '../../../shared/account';
import { TabScreen } from '../../../shared/screen';
import { useCredentials } from '../../credentials';
import { PAYOUT_ROUTE } from '../../payout';
import { DELETE_ACCOUNT_TEACHER_ROUTE } from '../navigation';

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
        me.isError ? (
          <AccountFailed onRetry={() => void me.refetch()} />
        ) : (
          <AccountLoading />
        )
      ) : (
        <>
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
            {account.teacher?.verificationStatus === 'approved' ? (
              <ListRow
                label={t('teacher.account.payout')}
                {...(account.teacher.payout.verified
                  ? { trailing: <Badge label={t('status.payout.verified')} tone="success" /> }
                  : {})}
                onPress={() => router.push(PAYOUT_ROUTE)}
              />
            ) : null}
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
