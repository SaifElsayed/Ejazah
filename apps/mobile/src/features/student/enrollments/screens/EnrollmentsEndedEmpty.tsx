// T050 (FR-390; screens.md §6 `EnrollmentsEndedEmpty`): the ended tab with nothing in it, under the
// tabs the screen draws.
import { EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';

export function EnrollmentsEndedEmpty() {
  const t = useT();
  return (
    <EmptyState
      icon={{ name: 'book' }}
      title={t('student.enrollments.endedEmpty.title')}
      text={t('student.enrollments.endedEmpty.text')}
    />
  );
}
