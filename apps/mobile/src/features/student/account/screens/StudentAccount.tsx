// T052 (FR-AUTH-5, FR-LOC-3, FR-AUTH-10, FR-GENDER-5, FR-AUTH-11, FR-AUTH-7): the student's account
// tab (StudentAccount): the profile row (avatar, name, address, «طالب · منذ …»), the shared
// settings, and sign-out behind its sheet. The rows whose screens land later are added with them
// (owner's decision, 2026-10-20): the notifications with their phase, the profile editor with its
// phase, «حذف الحساب» with B16.
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Avatar, Card, Icon, List, ListRow, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import {
  AccountFailed,
  AccountLoading,
  AccountSettings,
  initialsOf,
  SignOutSheet,
} from '../../../shared/account';
import { TabScreen } from '../../../shared/screen';

export function StudentAccount() {
  const t = useT();
  const format = useFormatters();
  const me = useMe();
  const [signingOut, setSigningOut] = useState(false);
  const account = me.data;
  return (
    <TabScreen header={<AppHeader title={t('account.title')} />}>
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
          <AccountSettings me={account} />
          <List>
            <ListRow
              label={t('account.signOut')}
              leading={<Icon name="log-out" tone="muted" />}
              onPress={() => setSigningOut(true)}
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
