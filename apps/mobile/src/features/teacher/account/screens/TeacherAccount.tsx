// T052 (FR-PROFILE-6, FR-AUTH-5, FR-LOC-3, FR-AUTH-10, FR-GENDER-5, FR-AUTH-11, FR-AUTH-7): the
// teacher's account tab (TeacherAccount): sign-out in the header, the avatar and name with the
// approved badge, and the settings the student's tab has. The teaching list and the delete row are
// added with their screens (owner's decision, 2026-10-20): «إجازاتي» with B11, «حساب الاستلام»
// with B15, «حذف الحساب» with B16, the public profile, the signature and the rating with their
// phases; the notifications with theirs.
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Avatar, Badge, Card, IconButton, Text } from '../../../../design/primitives';
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

export function TeacherAccount() {
  const t = useT();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const account = me.data;
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
          <AccountSettings me={account} />
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
