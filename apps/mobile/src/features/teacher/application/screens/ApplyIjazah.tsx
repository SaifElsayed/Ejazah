// T058 (FR-VERIFY-1, FR-VERIFY-2, FR-150, ADR 0017 D1): the third step. One ijazah PDF per chosen
// subject, each uploaded as it is picked; «إرسال الطلب» waits until every subject has its PDF, then
// sends the application (the first one keyed, a reapplication not) and opens its status. A refusal
// keeps the draft and says so in place.
// T110: each upload sits under its subject's name, as the board draws it, so two files that share
// a name are still told apart.
import { router } from 'expo-router';
import { useState } from 'react';

import { ActionBar, Banner, Button, PageIntro, Section } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { useSubjectName, useSubjects } from '../../../../lib/subjects';
import { PdfField } from '../../../shared/documents';
import { StackScreen } from '../../../shared/screen';
import { useApplicationActions } from '../api';
import { StepsHeader } from '../components/StepsHeader';
import { getApplication, ijazahsComplete, updateApplication, useApplicationDraft } from '../draft';

export function ApplyIjazah() {
  const t = useT();
  const draft = useApplicationDraft();
  const subjects = useSubjects();
  const nameOf = useSubjectName();
  const actions = useApplicationActions();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const chosen = (subjects.data ?? []).filter(({ id }) => draft.subjectIds.includes(id));

  async function send(): Promise<void> {
    setSending(true);
    setFailure(null);
    try {
      await actions.send(draft);
      router.replace('/(teacher)/application/status');
    } catch (caught: unknown) {
      setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setSending(false);
    }
  }

  return (
    <StackScreen
      header={<StepsHeader current={2} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.application.ijazahs.submit')}
            layout="block"
            loading={sending}
            disabled={!ijazahsComplete(draft) || draft.identity === undefined || sending}
            onPress={() => void send()}
          />
        </ActionBar>
      }
    >
      <PageIntro
        title={t('teacher.application.ijazahs.title')}
        lede={t('teacher.application.ijazahs.lede')}
      />
      {chosen.map((subject) => (
        <Section key={subject.id} title={nameOf(subject)}>
          <PdfField
            kind="credential"
            file={draft.ijazahs[subject.id]}
            label={t('teacher.application.ijazahs.upload', { subject: nameOf(subject) })}
            hint={t('common.file.pdfOnly')}
            onChange={(file) => {
              // Read now, not at render: another subject's upload may have landed meanwhile.
              const { [subject.id]: _replaced, ...others } = getApplication().ijazahs;
              updateApplication({
                ijazahs: file === undefined ? others : { ...others, [subject.id]: file },
              });
            }}
          />
        </Section>
      ))}
      {failure !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      ) : null}
    </StackScreen>
  );
}
