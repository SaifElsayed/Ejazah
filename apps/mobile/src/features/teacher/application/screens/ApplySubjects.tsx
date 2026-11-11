// T058 (FR-VERIFY-1, FR-VERIFY-2, FR-150): the first step. The admin's subjects as chips, one or
// more chosen, and the qualification in the person's words (1 to QUALIFICATION_MAX_LENGTH
// characters, the contract's bound). «التالي» waits for both.
import { QUALIFICATION_MAX_LENGTH } from '@ijazah/contracts';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  ActionBar,
  Button,
  Chip,
  Field,
  Input,
  PageIntro,
  Skeleton,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useSubjectName, useSubjects } from '../../../../lib/subjects';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { StepsHeader } from '../components/StepsHeader';
import { updateApplication, useApplicationDraft } from '../draft';

export function ApplySubjects() {
  const t = useT();
  const draft = useApplicationDraft();
  const subjects = useSubjects();
  const nameOf = useSubjectName();
  const qualification = draft.qualification.trim();
  const ready =
    draft.subjectIds.length > 0 &&
    qualification.length > 0 &&
    qualification.length <= QUALIFICATION_MAX_LENGTH;

  function toggle(id: string): void {
    updateApplication({
      subjectIds: draft.subjectIds.includes(id)
        ? draft.subjectIds.filter((chosen) => chosen !== id)
        : [...draft.subjectIds, id],
    });
  }

  return (
    <StackScreen
      header={<StepsHeader current={0} />}
      footer={
        <ActionBar>
          <Button
            label={t('teacher.application.subjects.next')}
            layout="block"
            disabled={!ready}
            onPress={() => router.push('/(teacher)/application/documents')}
          />
        </ActionBar>
      }
    >
      <PageIntro title={t('teacher.application.subjects.title')} />
      <Field
        label={t('teacher.application.subjects.subjectsLabel')}
        hint={t('teacher.application.subjects.subjectsHint')}
      >
        {subjects.data === undefined ? (
          <NotLoaded
            failed={subjects.isError}
            error={subjects.error}
            onRetry={() => void subjects.refetch()}
            loading={<Skeleton shape="block" />}
          />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] }}>
            {subjects.data.map((subject) => (
              <Chip
                key={subject.id}
                label={nameOf(subject)}
                selected={draft.subjectIds.includes(subject.id)}
                onPress={() => toggle(subject.id)}
              />
            ))}
          </View>
        )}
      </Field>
      <Field
        label={t('teacher.application.subjects.qualificationLabel')}
        hint={t('teacher.application.subjects.qualificationHint')}
      >
        <Input
          value={draft.qualification}
          onChangeText={(value) => updateApplication({ qualification: value })}
          multiline
        />
      </Field>
    </StackScreen>
  );
}
