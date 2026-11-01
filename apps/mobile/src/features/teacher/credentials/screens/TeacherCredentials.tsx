// T059 (FR-153, FR-ISNAD-1, FR-ISNAD-5, ADR 0017 D1): «إجازاتي». One card per credential, oldest
// first, as `teacher.credentials.list` answers them; a credential waiting on a document opens its
// request; «إضافة مادة» adds a subject (FR-PROFILE-11). Dates are in the account's zone.
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';

import { Banner, Button, NavHeader, Skeleton } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded, OfflineNotice } from '../../../shared/states';
import { useCredentialActions, useCredentials } from '../api';
import { CredentialCard } from '../components/CredentialCard';

/** An instant as the credentials date it: the full date in the account's zone. */
export function useCredentialDate(): (instant: string) => string {
  const me = useMe();
  const format = useFormatters();
  return (instant) => format.fullDate(instant, me.data?.timezone ?? 'UTC');
}

export function TeacherCredentials() {
  const t = useT();
  const credentials = useCredentials();
  const actions = useCredentialActions();
  const dated = useCredentialDate();
  const [failed, setFailed] = useState(false);

  async function openFile(credentialId: string): Promise<void> {
    setFailed(false);
    try {
      const { url } = await actions.documentLink(credentialId);
      await Linking.openURL(url);
    } catch {
      setFailed(true);
    }
  }

  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.credentials.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
    >
      {credentials.data === undefined ? (
        <NotLoaded
          failed={credentials.isError}
          onRetry={() => void credentials.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : (
        <>
          <OfflineNotice onRetry={() => void credentials.refetch()} />
          {credentials.data.map((credential) => (
            <CredentialCard
              key={credential.credentialId}
              credential={credential}
              dated={dated}
              onOpenRequest={() =>
                router.push({
                  pathname: '/(teacher)/credentials/[id]',
                  params: { id: credential.credentialId },
                })
              }
              onOpenFile={() => void openFile(credential.credentialId)}
            />
          ))}
          {failed ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t('common.state.actionError')}
            </Banner>
          ) : null}
          <Button
            label={t('common.action.addSubject')}
            variant="add"
            icon={{ name: 'plus' }}
            layout="block"
            onPress={() => router.push('/(teacher)/credentials/add')}
          />
        </>
      )}
    </StackScreen>
  );
}
