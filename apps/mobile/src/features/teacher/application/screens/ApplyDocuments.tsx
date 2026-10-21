// T058 (FR-VERIFY-1, FR-VERIFY-11, NFR-SEC-9): the second step. The identity document's kind, the
// national ID or the passport, and its one PDF, uploaded as it is picked. «التالي» waits for it.
import { router } from 'expo-router';

import { ActionBar, Button, PageIntro, Segmented } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { PdfField } from '../../../shared/documents';
import { StackScreen } from '../../../shared/screen';
import { StepsHeader } from '../components/StepsHeader';
import { updateApplication, useApplicationDraft } from '../draft';

export function ApplyDocuments() {
  const t = useT();
  const draft = useApplicationDraft();
  return (
    <StackScreen
      header={<StepsHeader current={1} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.application.documents.next')}
            layout="block"
            disabled={draft.identity === undefined}
            onPress={() => router.push('/(teacher)/application/ijazahs')}
          />
        </ActionBar>
      }
    >
      <PageIntro title={t('teacher.application.documents.title')} />
      <Segmented
        accessibilityLabel={t('teacher.application.documents.identityTitle')}
        options={[
          { value: 'national_id', label: t('teacher.application.documents.nationalId') },
          { value: 'passport', label: t('teacher.application.documents.passport') },
        ]}
        value={draft.identityType}
        onChange={(value) =>
          updateApplication({ identityType: value === 'passport' ? 'passport' : 'national_id' })
        }
      />
      <PdfField
        kind="identity"
        file={draft.identity}
        label={t('teacher.application.documents.identityTitle')}
        hint={t('teacher.application.documents.identityHint')}
        onChange={(identity) => updateApplication({ identity })}
      />
    </StackScreen>
  );
}
