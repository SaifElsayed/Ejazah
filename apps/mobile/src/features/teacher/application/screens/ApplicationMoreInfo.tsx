// T058 (FR-152, FR-VERIFY-4, FR-VERIFY-6): the reviewer asked for another document. The note with
// its date, then what may be replaced: a new PDF for each ijazah waiting on one (all of them before
// the resubmission), and the identity document, if the note asks for it. «إعادة إرسال الطلب» sends
// what was replaced (`teacher.application.resubmit`), which returns the application to the queue,
// and opens its status.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Badge,
  Banner,
  Button,
  Card,
  NavHeader,
  Section,
  Skeleton,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useSubjectName } from '../../../../lib/subjects';
import { AccountFailed } from '../../../shared/account';
import { PdfField, type UploadedPdf } from '../../../shared/documents';
import { StackScreen } from '../../../shared/screen';
import { useCredentials } from '../../credentials/api';
import { useApplicationActions, useApplicationStatus } from '../api';
import { useApplicationDate } from './ApplicationStatus';

export function ApplicationMoreInfo() {
  const t = useT();
  const application = useApplicationStatus();
  const credentials = useCredentials();
  const nameOf = useSubjectName();
  const dated = useApplicationDate();
  const actions = useApplicationActions();
  const [identity, setIdentity] = useState<UploadedPdf | undefined>(undefined);
  const [replaced, setReplaced] = useState<Readonly<Record<string, UploadedPdf>>>({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const asked = (credentials.data ?? []).filter(({ status }) => status === 'needs_document');
  const ready =
    asked.length > 0
      ? asked.every(({ credentialId }) => replaced[credentialId] !== undefined)
      : identity !== undefined;

  async function resubmit(): Promise<void> {
    setSending(true);
    setFailed(false);
    try {
      const credentialReplacements = asked.flatMap(({ credentialId }) => {
        const file = replaced[credentialId];
        return file === undefined ? [] : [{ credentialId, documentId: file.documentId }];
      });
      await actions.resubmit({
        ...(identity === undefined ? {} : { identityDocumentId: identity.documentId }),
        ...(credentialReplacements.length === 0 ? {} : { credentials: credentialReplacements }),
      });
      router.replace('/(teacher)/application/status');
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  const answer = application.data;
  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.application.moreInfo.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
      footer={
        <ActionBar>
          <Button
            label={t('teacher.application.moreInfo.resubmit')}
            layout="block"
            loading={sending}
            disabled={!ready || sending}
            onPress={() => void resubmit()}
          />
        </ActionBar>
      }
    >
      {answer === undefined || credentials.data === undefined ? (
        application.isError || credentials.isError ? (
          <AccountFailed
            onRetry={() => {
              void application.refetch();
              void credentials.refetch();
            }}
          />
        ) : (
          <Skeleton shape="block" />
        )
      ) : (
        <View style={{ gap: tokens.space['5'] }}>
          <Card variant="warning">
            <View style={{ alignSelf: 'flex-start' }}>
              <Badge label={t('status.application.needsDocument')} tone="warning" />
            </View>
            <Text variant="title-3">{t('teacher.application.moreInfo.heading')}</Text>
            {answer.note === undefined ? null : <Text>{answer.note}</Text>}
            <Text variant="caption" tone="muted">
              {dated(answer.decidedAt) === undefined
                ? t('common.reviewTeam.from')
                : t('common.reviewTeam.fromOn', { date: dated(answer.decidedAt) ?? '' })}
            </Text>
          </Card>
          <Section title={t('teacher.application.moreInfo.uploadTitle')}>
            <View style={{ gap: tokens.space['3'] }}>
              {asked.map((credential) => (
                <PdfField
                  key={credential.credentialId}
                  kind="credential"
                  file={replaced[credential.credentialId]}
                  label={t('teacher.application.ijazahs.upload', {
                    subject: nameOf(credential.subject),
                  })}
                  hint={t('common.file.pdfOnly')}
                  replaceOnly
                  onChange={(file) => {
                    if (file !== undefined) {
                      setReplaced((current) => ({ ...current, [credential.credentialId]: file }));
                    }
                  }}
                />
              ))}
              <PdfField
                kind="identity"
                file={identity}
                label={t('teacher.application.documents.identityTitle')}
                hint={t('teacher.application.documents.identityHint')}
                onChange={setIdentity}
              />
            </View>
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
