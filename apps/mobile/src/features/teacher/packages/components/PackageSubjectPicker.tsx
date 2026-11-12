// T021 (FR-311, FR-PROFILE-11 as amended on 2026-10-31): the package's subject (screens.md §13,
// PackageSubjectPicker). Only the subjects of the teacher's approved credentials are offered, a
// subject under review or refused never; no search, the list being short (it scrolls, 002:T137).
// «إضافة مادة» leads to adding a subject; «تم» closes. Until the credentials are read the sheet says
// why it is empty, as the shared states do.
import type { SubjectSummary } from '@ijazah/contracts';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Picker, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useSubjectName } from '../../../../lib/subjects';
import { NotLoaded } from '../../../shared/states';
import { useCredentials } from '../../credentials';

const ADD_SUBJECT_ROUTE = '/(teacher)/credentials/add';

/** The subjects of the teacher's approved credentials, once each. */
export function approvedSubjects(
  credentials: readonly { readonly subject: SubjectSummary; readonly status: string }[],
): SubjectSummary[] {
  const seen = new Set<string>();
  return credentials.flatMap(({ subject, status }) => {
    if (status !== 'approved' || seen.has(subject.id)) return [];
    seen.add(subject.id);
    return [subject];
  });
}

export function PackageSubjectPicker({
  open,
  value,
  onChange,
  onClose,
}: {
  readonly open: boolean;
  readonly value?: SubjectSummary;
  readonly onChange: (subject: SubjectSummary) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const nameOf = useSubjectName();
  const credentials = useCredentials();
  const subjects = credentials.data === undefined ? [] : approvedSubjects(credentials.data);
  return (
    <Sheet open={open} onClose={onClose} title={t('teacher.packages.editor.subjectPicker.title')}>
      {credentials.data === undefined ? (
        <NotLoaded
          failed={credentials.isError}
          error={credentials.error}
          onRetry={() => void credentials.refetch()}
        />
      ) : (
        <Picker
          options={subjects.map((subject) => ({ value: subject.id, label: nameOf(subject) }))}
          {...(value === undefined ? {} : { value: value.id })}
          onChange={(id) => {
            const chosen = subjects.find((subject) => subject.id === id);
            if (chosen !== undefined) onChange(chosen);
          }}
        />
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space['2'],
        }}
      >
        <Text variant="callout" tone="muted">
          {t('teacher.packages.editor.subjectPicker.addAnother')}
        </Text>
        <Button
          label={t('common.action.addSubject')}
          variant="ghost"
          size="md"
          icon={{ name: 'plus' }}
          onPress={() => {
            onClose();
            router.push(ADD_SUBJECT_ROUTE);
          }}
        />
      </View>
      <Button label={t('common.action.done')} layout="block" onPress={onClose} />
    </Sheet>
  );
}
