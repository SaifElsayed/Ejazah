// T044 (FR-350, FR-351, FR-386; screens.md §5 BookingSheet and SlotTaken): the booking sheet over the
// teacher's page, for the package the student chose there. It shows the package with its track and
// the teacher's city, then the slots `booking.slots` offers: each as the teacher set it, in the
// teacher's zone, and, when the student lives in another zone, as its first session falls in the
// student's (ADR 0009 D5). The chosen slot's first and last session dates come from the answer
// (FR-368's rule, from now). «متابعة إلى الدفع» stays disabled until a free slot is chosen, then
// places the hold with the key kept for that choice (FR-106): a retry after a lost answer is one
// hold, another slot is a new key. On the hold it closes and goes to the checkout; `SLOT_TAKEN` keeps
// it open with the taken slot marked booked and disabled (`SlotTaken`); `PREVIOUS_CHECKOUT` goes to
// `CheckoutPrevious` (FR-BOOK-12); any other refusal is the generic failure. The sheet is a window of
// its own over every screen, so it closes before the next screen opens.
// 006:T019 (FR-701, DEC-94): a programme package books its assessment: the line names it, each
// weekly time `booking.slots` answers (at least the assessment's length, none overlapping the
// student's own programme's time) is offered with its own length, and the time chosen says the
// programme's sessions there last up to that length and when the assessment falls.
import type { BookingSlot, DiscoveryTeacherPackage } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Sheet,
  Skeleton,
  Slot,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { useFormatters, weekdayIn } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { NotLoaded } from '../../../shared/states';
import { TRACK_LABEL } from '../../discovery/tracks';
import { useBookingSlots, useHold } from '../api';

/** The slot chosen and the idempotency key its hold is sent with. */
interface Choice {
  readonly slotId: string;
  readonly key: string;
}

/** The fraction of the screen the sheet may take; the slots scroll inside it. */
const SHEET_HEIGHT = 0.9;

export function BookingSheet({
  item,
  onClose,
}: {
  /** The package chosen on the teacher's page. */
  readonly item: DiscoveryTeacherPackage;
  readonly onClose: () => void;
}) {
  const t = useT();
  const slots = useBookingSlots(item.packageId);
  const answer = slots.data;
  return (
    <Sheet open onClose={onClose} title={t('student.booking.title')} snapPoints={[SHEET_HEIGHT]}>
      {answer === undefined ? (
        <NotLoaded
          failed={slots.isError}
          error={slots.error}
          onRetry={() => void slots.refetch()}
          loading={<Skeleton shape="block" />}
        />
      ) : (
        <Booking
          item={item}
          teacherZone={answer.teacherTimezone}
          slots={answer.slots}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function Booking({
  item,
  teacherZone,
  slots,
  onClose,
}: {
  readonly item: DiscoveryTeacherPackage;
  readonly teacherZone: string;
  readonly slots: readonly BookingSlot[];
  readonly onClose: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const hold = useHold();
  const studentZone = useMe().data?.timezone;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [taken, setTaken] = useState<readonly string[]>([]);
  const [lastTaken, setLastTaken] = useState<BookingSlot | null>(null);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = slots.find(({ slotId }) => slotId === choice?.slotId && !taken.includes(slotId));
  const otherZone =
    studentZone === undefined || studentZone === teacherZone ? undefined : studentZone;
  const programme = item.isProgramme === true;
  const label = (slot: BookingSlot) => {
    const when = t('common.format.dateTime', {
      date: format.weekday(slot.dayOfWeek),
      time: format.wallClock(slot.startTimeLocal),
    });
    return programme
      ? t('programme.student.booking.slot', { slot: when, minutes: slot.durationMinutes })
      : when;
  };

  function choose(slotId: string): void {
    if (choice?.slotId === slotId) return;
    setChoice({ slotId, key: Crypto.randomUUID() });
    setFailure(null);
  }

  async function proceed(): Promise<void> {
    if (chosen === undefined || choice === null) return;
    setBusy(true);
    setFailure(null);
    try {
      await hold.place({
        packageId: item.packageId,
        slotId: chosen.slotId,
        idempotencyKey: choice.key,
      });
      onClose();
      router.push('/(student)/checkout');
    } catch (caught: unknown) {
      const code = errorCodeOf(caught);
      if (code === 'SLOT_TAKEN') {
        setTaken((before) => [...before, chosen.slotId]);
        setLastTaken(chosen);
        setChoice(null);
      } else if (code === 'PREVIOUS_CHECKOUT') {
        onClose();
        router.push('/(student)/checkout/previous');
      } else {
        setFailure(genericErrorKey(caught, 'common.state.actionError'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (slots.length === 0) {
    return (
      <>
        <PackageLine item={item} teacherZone={teacherZone} />
        <EmptyState
          icon={{ name: 'calendar' }}
          title={t('student.booking.noSlots.title')}
          text={t('student.booking.noSlots.text')}
          action={{ label: t('student.booking.noSlots.action'), onPress: onClose }}
        />
      </>
    );
  }

  return (
    <>
      <PackageLine item={item} teacherZone={teacherZone} />
      {lastTaken !== null ? (
        <Alert text={t('student.booking.slotTaken', { slot: label(lastTaken) })} />
      ) : failure !== null ? (
        <Alert text={t(failure.key, failure.values)} />
      ) : null}
      <ScrollView style={{ flexGrow: 0, flexShrink: 1 }}>
        <View style={{ gap: tokens.space['3'] }}>
          <Text variant="headline">{t('student.booking.availableSlots')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] }}>
            {slots.map((slot) => (
              <SlotChoice
                key={slot.slotId}
                label={label(slot)}
                startsAt={slot.firstSession.startsAt}
                otherZone={otherZone}
                state={
                  taken.includes(slot.slotId)
                    ? 'taken'
                    : slot.slotId === chosen?.slotId
                      ? 'selected'
                      : 'available'
                }
                onPress={() => choose(slot.slotId)}
              />
            ))}
          </View>
          {chosen === undefined ? null : programme ? (
            <AssessmentLines slot={chosen} teacherZone={teacherZone} />
          ) : (
            <Text variant="callout" tone="muted">
              {t('student.booking.range', {
                firstDate: format.date(chosen.firstSession.startsAt, teacherZone),
                time: format.time(chosen.firstSession.startsAt, teacherZone),
                lastDate: format.date(chosen.lastSession.startsAt, teacherZone),
              })}
            </Text>
          )}
        </View>
      </ScrollView>
      <Button
        label={t('student.booking.continueToPayment')}
        layout="block"
        loading={busy}
        disabled={busy || chosen === undefined}
        onPress={() => void proceed()}
      />
    </>
  );
}

/** «{subject} · N × M دقيقة · بتوقيت {city}» with the track's badge, in the teacher's city (D5). */
function PackageLine({
  item,
  teacherZone,
}: {
  readonly item: DiscoveryTeacherPackage;
  readonly teacherZone: string;
}) {
  const t = useT();
  const locale = useLocale();
  const nameOf = useSubjectName();
  const city = cityOf(teacherZone, locale) ?? teacherZone;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.space['2'],
      }}
    >
      <Text variant="callout">
        {item.isProgramme === true
          ? t('programme.student.booking.packageLine', { subject: nameOf(item.subject), city })
          : t('student.booking.packageLine', {
              subject: nameOf(item.subject),
              sessions: item.sessionCount,
              minutes: item.sessionDurationMinutes,
              city,
            })}
      </Text>
      <Badge
        label={t(TRACK_LABEL[item.track])}
        tone={item.track === 'ijazah_track' ? 'accent' : 'neutral'}
      />
    </View>
  );
}

/**
 * 006:T019: the weekly time chosen for an assessment: the programme's sessions there last up to its
 * length (FR-705), and the one session it books, in the teacher's zone.
 */
function AssessmentLines({
  slot,
  teacherZone,
}: {
  readonly slot: BookingSlot;
  readonly teacherZone: string;
}) {
  const t = useT();
  const format = useFormatters();
  return (
    <>
      <Text variant="callout">
        {t('programme.student.booking.upTo', { minutes: slot.durationMinutes })}
      </Text>
      <Text variant="callout" tone="muted">
        {t('programme.student.booking.assessmentAt', {
          date: format.date(slot.firstSession.startsAt, teacherZone),
          time: format.time(slot.firstSession.startsAt, teacherZone),
        })}
      </Text>
    </>
  );
}

/**
 * One slot: as the teacher set it, and under it, when the student lives in another zone, the day
 * and time its first session falls on there. A taken slot is drawn booked and cannot be pressed.
 */
function SlotChoice({
  label,
  startsAt,
  otherZone,
  state,
  onPress,
}: {
  readonly label: string;
  /** The slot's first session, the instant shown in the student's zone. */
  readonly startsAt: string;
  readonly otherZone: string | undefined;
  readonly state: 'available' | 'selected' | 'taken';
  readonly onPress: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const button =
    state === 'taken' ? (
      <Slot label={t('student.booking.slotBooked', { slot: label })} state="disabled" />
    ) : (
      <Slot label={label} state={state} onPress={onPress} />
    );
  if (otherZone === undefined) return button;
  return (
    <View style={{ gap: tokens.space['1'] }}>
      {button}
      <Text variant="caption" tone="muted">
        {t('student.booking.inYourZone', {
          slot: t('common.format.dateTime', {
            date: format.weekday(weekdayIn(startsAt, otherZone)),
            time: format.time(startsAt, otherZone),
          }),
        })}
      </Text>
    </View>
  );
}

/** The danger banner, read out as soon as it appears (`role=alert` on the board). */
function Alert({ text }: { readonly text: string }) {
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {text}
      </Banner>
    </View>
  );
}
