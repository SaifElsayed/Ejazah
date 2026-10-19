// T034 (FR-202): the availability tab before the first slot (`AvailabilityEmpty`). The slot
// editor behind «موعد» and the zone in the subtitle arrive with the availability in Phase 2.
import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function AvailabilityEmpty() {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.availability.title')} />}>
      <EmptyState
        icon={{ name: 'clock' }}
        title={t('teacher.availability.empty.title')}
        text={t('teacher.availability.empty.text')}
      />
    </TabScreen>
  );
}
