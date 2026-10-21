// T059 (FR-PROFILE-11, ADR 0017 D2): the subject picker sheet of `AddSubject`. The admin's subjects,
// searchable; a subject the teacher already holds, approved or waiting for review, is disabled with
// its status, since a second credential for it is refused (T057). A rejected one may be sent again.
import type { CredentialSummary, SubjectSummary } from '@ijazah/contracts';

import { Picker, Sheet } from '../../../../design/primitives';
import { type MessageKey, useT } from '../../../../i18n';
import { useSubjectName } from '../../../../lib/subjects';

/** The statuses that hold a subject, and how the picker names them. */
const HOLDING: Readonly<Partial<Record<CredentialSummary['status'], MessageKey>>> = {
  approved: 'status.credential.approved',
  pending: 'status.credential.pending',
  needs_document: 'status.credential.needsDocument',
};

export function SubjectPicker({
  open,
  subjects,
  held,
  value,
  onChange,
  onClose,
}: {
  readonly open: boolean;
  readonly subjects: readonly SubjectSummary[];
  readonly held: readonly CredentialSummary[];
  readonly value?: string;
  readonly onChange: (subjectId: string) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const nameOf = useSubjectName();
  const holding = (subjectId: string): MessageKey | undefined =>
    held
      .map(({ subject, status }) => (subject.id === subjectId ? HOLDING[status] : undefined))
      .find((label) => label !== undefined);
  return (
    <Sheet open={open} onClose={onClose} title={t('teacher.credentials.add.picker.title')}>
      <Picker
        options={subjects.map((subject) => {
          const status = holding(subject.id);
          return {
            value: subject.id,
            label: nameOf(subject),
            ...(status === undefined ? {} : { hint: t(status), disabled: true }),
          };
        })}
        {...(value === undefined ? {} : { value })}
        onChange={onChange}
        searchPlaceholder={t('teacher.credentials.add.picker.search')}
      />
    </Sheet>
  );
}
