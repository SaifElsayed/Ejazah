// T052 (FR-AUTH-5, FR-LOC-3, FR-AUTH-10, FR-GENDER-5, FR-AUTH-11, FR-AUTH-7): the student's account
// tab (StudentAccount): the profile row (avatar, name, address, «طالب · منذ …»), the shared
// settings, and sign-out behind its sheet. The rows whose screens land later are added with them
// (owner's decision, 2026-10-20): the notifications with their phase. Since B16 (T084) «الملف
// الشخصي» leads the first list to the profile editor, and the danger row «حذف الحساب» follows
// sign-out to the deletion, as the board draws them.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Avatar, Card, Icon, List, ListRow, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { AccountLoading, AccountSettings, initialsOf, SignOutSheet } from '../../../shared/account';
import { TabScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { DELETE_ACCOUNT_ROUTE, PROFILE_EDITOR_ROUTE } from '../navigation';

export function StudentAccount() {
  const t = useT();
  const format = useFormatters();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const account = me.data;
  return (
    <TabScreen header={<AppHeader title={t('account.title')} />}>
      {account === undefined ? (
        <NotLoaded
          failed={me.isError}
          error={me.error}
          onRetry={() => void me.refetch()}
          loading={<AccountLoading />}
        />
      ) : (
        <>
          <OfflineNotice onRetry={() => void me.refetch()} />
          <Card variant="row">
            <Avatar
              initials={initialsOf(account.displayName)}
              size="lg"
              {...(account.photoUrl === undefined ? {} : { imageUri: account.photoUrl })}
            />
            <View style={{ flex: 1, minWidth: 0, gap: tokens.space['1'] }}>
              <Text variant="headline">{account.displayName}</Text>
              {account.email === null ? null : (
                <Text variant="callout" tone="muted" ltr>
                  {account.email}
                </Text>
              )}
              <Text variant="caption" tone="muted">
                {t('account.memberSince', {
                  gender: account.gender,
                  date: format.fullDate(account.memberSince, account.timezone),
                })}
              </Text>
            </View>
          </Card>
          <AccountSettings
            me={account}
            leading={
              <ListRow
                label={t('account.profile')}
                value={t('account.profileValue')}
                onPress={() => router.push(PROFILE_EDITOR_ROUTE)}
              />
            }
          />
          <List>
            <ListRow
              label={t('account.signOut')}
              leading={<Icon name="log-out" tone="muted" />}
              onPress={() => setSigningOut(true)}
            />
            <ListRow
              label={t('account.deleteAccount')}
              tone="danger"
              leading={<Icon name="trash" tone="danger" />}
              onPress={() => router.push(DELETE_ACCOUNT_ROUTE)}
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
