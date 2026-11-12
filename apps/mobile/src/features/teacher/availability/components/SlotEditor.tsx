// T022 (FR-313, FR-317, FR-318; screens.md §13 SlotEditor): a new slot or one of the teacher's,
// in one sheet. «اليوم» as the seven days, «يبدأ» chosen from the quarter hours in the sheet's own
// list, «المدة» 30, 45 or 60 minutes, and the zone the slot is read in by its city: the teacher's
// for a new slot, the slot's own for one already made. A new slot is created keyed, one key per
// opening of the editor (FR-106); an edit sends only what changed. `SLOT_OVERLAP` and
// `SLOT_IN_USE` are said in place and the editor stays open. A free slot is disabled at once; a
// disabled one is enabled again with «تفعيل الموعد». A booked slot opens here too, its day, start
// and length shown fixed with the reason (FR-318) and nothing to save, and is disabled through
// `SlotDisableSheet` (FR-PROFILE-9; the owner's decision of 2026-11-02, B26).
import type { TeacherSlot } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Chip,
  Field,
  Picker,
  Segmented,
  Select,
  Sheet,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { useFormatters } from '../../../../lib/formatters';
import { useSlotActions } from '../api';
import { changeOf, SLOT_LENGTHS, type SlotLength, startTimes, WEEK } from '../week';
import { SlotDisableSheet } from './SlotDisableSheet';

/** The refusals said in place; any other is the generic failure. */
const PROBLEMS: Readonly<Record<string, MessageKey>> = {
  SLOT_OVERLAP: 'teacher.availability.editor.error.overlap',
  SLOT_IN_USE: 'teacher.availability.editor.error.inUse',
};

export function SlotEditor({
  slot,
  timezone,
  onClose,
}: {
  /** The slot to edit; none for a new one. */
  readonly slot?: TeacherSlot;
  /** The teacher's zone, a new slot's. */
  readonly timezone: string;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const actions = useSlotActions();
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  const [dayOfWeek, setDayOfWeek] = useState(slot?.dayOfWeek);
  const [start, setStart] = useState(slot?.startTimeLocal);
  const [length, setLength] = useState<SlotLength | undefined>(slot?.durationMinutes);
  const [step, setStep] = useState<'form' | 'start' | 'disable'>('form');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ErrorMessage | null>(null);
  const zone = slot?.timezone ?? timezone;
  const city = cityOf(zone, locale) ?? zone;
  const booked = slot?.state === 'booked' ? slot : undefined;

  if (step === 'disable' && slot !== undefined) {
    return <SlotDisableSheet slot={slot} onCancel={() => setStep('form')} onDone={onClose} />;
  }

  async function send(call: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await call();
      onClose();
    } catch (caught: unknown) {
      const said = PROBLEMS[errorCodeOf(caught) ?? ''];
      setProblem(
        said === undefined ? genericErrorKey(caught, 'common.state.actionError') : { key: said },
      );
    } finally {
      setBusy(false);
    }
  }

  function save(): void {
    if (dayOfWeek === undefined || start === undefined || length === undefined) return;
    const draft = { dayOfWeek, startTimeLocal: start, durationMinutes: length };
    if (slot === undefined) {
      void send(() => actions.create({ ...draft, idempotencyKey }));
      return;
    }
    const change = changeOf(slot, draft);
    if (Object.keys(change).length === 0) onClose();
    else void send(() => actions.update({ slotId: slot.id, ...change }));
  }

  function disable(of: TeacherSlot): void {
    if (of.state === 'booked') setStep('disable');
    else void send(() => actions.update({ slotId: of.id, isActive: false }));
  }

  const title = t(
    slot === undefined
      ? 'teacher.availability.editor.newTitle'
      : 'teacher.availability.editor.title',
  );

  if (step === 'start') {
    return (
      <Sheet open onClose={onClose} title={title}>
        <Picker
          options={startTimes(slot?.startTimeLocal).map((value) => ({
            value,
            label: format.wallClock(value),
          }))}
          {...(start === undefined ? {} : { value: start })}
          onChange={(value) => {
            setStart(value);
            setStep('form');
          }}
        />
        <Button
          label={t('common.action.back')}
          variant="ghost"
          layout="block"
          onPress={() => setStep('form')}
        />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      {problem === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(problem.key, problem.values)}
        </Banner>
      )}
      {booked !== undefined ? (
        <>
          <Field label={t('teacher.availability.editor.day')}>
            <Text variant="body-lg">{format.weekday(booked.dayOfWeek)}</Text>
          </Field>
          <Field label={t('teacher.availability.editor.starts')}>
            <Text variant="body-lg">{format.wallClock(booked.startTimeLocal)}</Text>
          </Field>
          <Field
            label={t('teacher.availability.editor.duration')}
            hint={t('teacher.availability.editor.timeZoneHint', { city })}
          >
            <Text variant="body-lg">
              {t('teacher.availability.editor.durationOption', { minutes: booked.durationMinutes })}
            </Text>
          </Field>
          <Text variant="caption" tone="muted">
            {t('teacher.availability.editor.error.inUse')}
          </Text>
        </>
      ) : (
        <>
          <Field label={t('teacher.availability.editor.day')}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] }}>
              {WEEK.map((day) => (
                <Chip
                  key={day}
                  label={format.weekday(day)}
                  selected={day === dayOfWeek}
                  onPress={() => setDayOfWeek(day)}
                />
              ))}
            </View>
          </Field>
          <Field label={t('teacher.availability.editor.starts')}>
            <Select
              label={t('teacher.availability.editor.starts')}
              {...(start === undefined ? {} : { value: format.wallClock(start) })}
              size="md"
              onPress={() => setStep('start')}
            />
          </Field>
          <Field
            label={t('teacher.availability.editor.duration')}
            hint={t('teacher.availability.editor.timeZoneHint', { city })}
          >
            <Segmented
              accessibilityLabel={t('teacher.availability.editor.duration')}
              options={SLOT_LENGTHS.map((minutes) => ({
                value: String(minutes),
                label: t('teacher.availability.editor.durationOption', { minutes }),
              }))}
              value={length === undefined ? '' : String(length)}
              onChange={(value) =>
                setLength(SLOT_LENGTHS.find((minutes) => String(minutes) === value))
              }
            />
          </Field>
        </>
      )}
      <View style={{ gap: tokens.space['2'] }}>
        {booked !== undefined ? null : (
          <Button
            label={t('teacher.availability.editor.save')}
            layout="block"
            loading={busy}
            disabled={
              busy || dayOfWeek === undefined || start === undefined || length === undefined
            }
            onPress={save}
          />
        )}
        {slot === undefined ? null : slot.isActive ? (
          <>
            <Button
              label={t('teacher.availability.editor.disable')}
              variant="danger"
              size="md"
              layout="block"
              disabled={busy}
              onPress={() => disable(slot)}
            />
            <Text variant="caption" tone="muted" align="center">
              {t('teacher.availability.editor.disableNote')}
            </Text>
          </>
        ) : (
          <Button
            label={t('teacher.availability.editor.enable')}
            variant="secondary"
            size="md"
            layout="block"
            disabled={busy}
            onPress={() => void send(() => actions.update({ slotId: slot.id, isActive: true }))}
          />
        )}
      </View>
    </Sheet>
  );
}
