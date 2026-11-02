// T034 (FR-202): the availability tab before the first slot (`AvailabilityEmpty`). T022 (FR-313):
// the header gains the teacher's city and «موعد», which opens the slot editor, and the offline
// notice sits above the empty state while there is no connection.
import type { ReactNode } from 'react';

import { EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';
import { AvailabilityHeader } from '../components/AvailabilityHeader';

export function AvailabilityEmpty({
  city,
  onAdd,
  notice,
}: {
  readonly city?: string;
  readonly onAdd?: () => void;
  readonly notice?: ReactNode;
}) {
  const t = useT();
  return (
    <TabScreen
      header={
        <AvailabilityHeader
          {...(city === undefined ? {} : { city })}
          {...(onAdd === undefined ? {} : { onAdd })}
        />
      }
    >
      {notice}
      <EmptyState
        icon={{ name: 'clock' }}
        title={t('teacher.availability.empty.title')}
        text={t('teacher.availability.empty.text')}
      />
    </TabScreen>
  );
}
