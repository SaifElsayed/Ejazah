// T022 (screens.md §13): the availability's header, «المواعيد» with the teacher's city and «موعد»
// once the slots are read (the zone is the teacher's, named by its city, never the IANA id).
import { AppHeader, Button } from '../../../../design/primitives';
import { useT } from '../../../../i18n';

export function AvailabilityHeader({
  city,
  onAdd,
}: {
  readonly city?: string;
  readonly onAdd?: () => void;
}) {
  const t = useT();
  return (
    <AppHeader
      title={t('teacher.availability.title')}
      {...(city === undefined ? {} : { subtitle: t('teacher.availability.subtitle', { city }) })}
      actions={
        onAdd === undefined ? undefined : (
          <Button
            label={t('teacher.availability.addSlot')}
            icon={{ name: 'plus' }}
            size="md"
            onPress={onAdd}
          />
        )
      }
    />
  );
}
