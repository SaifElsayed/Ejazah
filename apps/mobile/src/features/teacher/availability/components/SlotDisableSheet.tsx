// T022 (FR-314, FR-318; screens.md §13 SlotDisableSheet): the confirmation before a booked slot is
// disabled. It is no longer offered for new holds, the sessions booked on it keep their times, and
// it can be enabled again. The board's line naming the student, the subject and the enrollment's
// end is not drawn: `teacher.slots.list` answers no enrollment, and the task asks for none. «إلغاء»
// returns to the editor, as does dismissing the sheet.
import type { TeacherSlot } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Button, IconTile, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { useSlotActions } from '../api';

export function SlotDisableSheet({
  slot,
  onCancel,
  onDone,
}: {
  readonly slot: TeacherSlot;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const actions = useSlotActions();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function disable(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await actions.update({ slotId: slot.id, isActive: false });
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onCancel}>
      <View style={{ gap: tokens.space['3'] }}>
        <IconTile icon={{ name: 'clock' }} tone="warning" size="lg" />
        <Text variant="title-3">
          {t('teacher.availability.disableSheet.title', {
            day: format.weekday(slot.dayOfWeek),
            time: format.wallClock(slot.startTimeLocal),
          })}
        </Text>
        <Text tone="muted">{t('teacher.availability.disableSheet.textBooked')}</Text>
      </View>
      {failed ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
      <View style={{ gap: tokens.space['2'] }}>
        <Button
          label={t('teacher.availability.disableSheet.confirm')}
          variant="danger"
          layout="block"
          loading={busy}
          disabled={busy}
          onPress={() => void disable()}
        />
        <Button
          label={t('common.action.cancel')}
          variant="ghost"
          layout="block"
          disabled={busy}
          onPress={onCancel}
        />
      </View>
    </Sheet>
  );
}
