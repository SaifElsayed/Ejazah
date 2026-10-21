// T059 (FR-153, FR-ADMIN-19, ADR 0017 D2): a credential the reviewer asked another PDF for. Its
// subject, the reviewer's note and when it was written, the current file; «رفع ملف آخر» opens the
// picker, uploads the new PDF and sends it (`teacher.credentials.replaceDocument`), and the
// credential waits for review again on the credentials page.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Badge,
  Banner,
  Button,
  Card,
  FileRow,
  NavHeader,
  Section,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useApi } from '../../../../lib/api';
import { pickPdf } from '../../../../lib/files';
import { useSubjectName } from '../../../../lib/subjects';
import { AccountFailed } from '../../../shared/account';
import { useFileSize } from '../../../shared/documents';
import { StackScreen } from '../../../shared/screen';
import { useCredentialActions, useCredentials } from '../api';
import { useCredentialDate } from './TeacherCredentials';

export function CredentialNeedsDocument() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useApi();
  const credentials = useCredentials();
  const actions = useCredentialActions();
  const nameOf = useSubjectName();
  const size = useFileSize();
  const dated = useCredentialDate();
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const credential = credentials.data?.find(({ credentialId }) => credentialId === id);

  async function replace(credentialId: string): Promise<void> {
    const picked = await pickPdf();
    if (picked === null) return;
    setSending(true);
    setFailed(false);
    try {
      const documentId = await client.uploadDocument('credential', picked);
      await actions.replaceDocument(credentialId, documentId);
      router.back();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  const subject = credential === undefined ? '' : nameOf(credential.subject);
  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.credentials.credential.title', { subject })}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
      footer={
        credential === undefined ? undefined : (
          <ActionBar>
            <Button
              label={t('teacher.credentials.credential.uploadAnother')}
              layout="block"
              icon={{ name: 'upload' }}
              loading={sending}
              disabled={sending || credential.status !== 'needs_document'}
              onPress={() => void replace(credential.credentialId)}
            />
          </ActionBar>
        )
      }
    >
      {credential === undefined ? (
        credentials.isError ? (
          <AccountFailed onRetry={() => void credentials.refetch()} />
        ) : (
          <Skeleton shape="block" />
        )
      ) : (
        <View style={{ gap: tokens.space['5'] }}>
          <Card variant="warning">
            <View style={{ alignSelf: 'flex-start' }}>
              <Badge label={t('status.credential.needsDocument')} tone="warning" />
            </View>
            <Text variant="title-3">{t('teacher.credentials.credential.heading')}</Text>
            {credential.note === undefined ? null : <Text>{credential.note}</Text>}
            <Text variant="caption" tone="muted">
              {credential.reviewedAt === undefined
                ? t('common.reviewTeam.from')
                : t('common.reviewTeam.fromOn', { date: dated(credential.reviewedAt) })}
            </Text>
          </Card>
          <Section title={t('teacher.credentials.credential.currentFile')}>
            <FileRow
              name={t('teacher.credentials.fileName', { subject })}
              {...(credential.document.sizeBytes === undefined
                ? {}
                : { meta: size(credential.document.sizeBytes) })}
            />
          </Section>
          {failed ? (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t('common.state.actionError')}
            </Banner>
          ) : null}
        </View>
      )}
    </StackScreen>
  );
}
