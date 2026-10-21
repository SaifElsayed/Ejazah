// T059 (FR-153, FR-PROFILE-11, ADR 0017 D2): an approved teacher adds a subject. The subject is
// chosen in the picker sheet (`SubjectPicker`), where a subject already held, approved or waiting,
// is shown disabled with its status; its ijazah PDF is uploaded as it is picked; «إرسال للمراجعة»
// waits for both, sends the credential (`teacher.credentials.add`) and returns to the credentials
// page. The subject becomes the teacher's only on approval.
import { router } from 'expo-router';
import { useState } from 'react';

import { ActionBar, Banner, Button, NavHeader, Select, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useSubjectName, useSubjects } from '../../../../lib/subjects';
import { PdfField, type UploadedPdf } from '../../../shared/documents';
import { StackScreen } from '../../../shared/screen';
import { useCredentialActions, useCredentials } from '../api';
import { SubjectPicker } from '../components/SubjectPicker';

export function AddSubject() {
  const t = useT();
  const subjects = useSubjects();
  const credentials = useCredentials();
  const actions = useCredentialActions();
  const nameOf = useSubjectName();
  const [subjectId, setSubjectId] = useState<string | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const [file, setFile] = useState<UploadedPdf | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = subjects.data?.find(({ id }) => id === subjectId);

  async function send(): Promise<void> {
    if (subjectId === undefined || file === undefined) return;
    setSending(true);
    setFailed(false);
    try {
      await actions.add(subjectId, file.documentId);
      router.back();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <StackScreen
      header={
        <NavHeader
          title={t('teacher.credentials.add.title')}
          back={{ kind: 'back', onPress: () => router.back() }}
        />
      }
      footer={
        <ActionBar>
          <Button
            label={t('teacher.credentials.add.submit')}
            layout="block"
            loading={sending}
            disabled={chosen === undefined || file === undefined || sending}
            onPress={() => void send()}
          />
        </ActionBar>
      }
    >
      <Select
        label={t('teacher.credentials.add.subject')}
        placeholder={t('teacher.credentials.add.picker.placeholder')}
        {...(chosen === undefined ? {} : { value: nameOf(chosen) })}
        onPress={() => setPicking(true)}
      />
      <PdfField
        kind="credential"
        file={file}
        label={t('teacher.credentials.add.yourIjazah')}
        hint={t('teacher.credentials.add.pdfOnly')}
        onChange={setFile}
      />
      <Text variant="caption" tone="muted">
        {t('teacher.credentials.add.note')}
      </Text>
      {failed ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
      <SubjectPicker
        open={picking}
        subjects={subjects.data ?? []}
        held={credentials.data ?? []}
        {...(subjectId === undefined ? {} : { value: subjectId })}
        onChange={(id) => {
          setSubjectId(id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </StackScreen>
  );
}
