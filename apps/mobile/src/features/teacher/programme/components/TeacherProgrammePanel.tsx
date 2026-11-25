// 006:T020 (FR-705, FR-706b, FR-723, FR-726; SRS DEC-112; B-P4's conflict check, Q-2 (a), Q-3 (a)):
// the teacher's programme on the enrollment's page (`IjazahRequestPanel`'s pattern: a card, its badge,
// its lines and its actions), read from `programme.get` only for an enrollment the read marks as a
// programme; what it offers is `gates.ts`'s. Awaiting the offer with the assessment delivered: the
// offer form (`OfferForm`). Once offered and while it runs: the offer as sent, its sessions, months,
// total and the student's deadline. While `payBlocked`: the line that the offer is with the
// administration because the payout account was not verified (FR-706b). While it runs: the months
// paid and the next due; paused, that the student is late and since when (FR-726). The stop request
// from `stopRequestFrom` on (`StopRequest`). No refusal request, button or hint (SRS DEC-112). Every
// date and time in the teacher's zone; money by `formatPounds`; a failed read says so.
import type {
  ProgrammeGetOutput,
  ProgrammeOffer,
  ProgrammeState,
  TeacherStudentsGetOutput,
} from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { View } from 'react-native';

import { Badge, type BadgeProps, Banner, Card, Summary, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useLocale, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { LoadError } from '../../../shared/states';
import { useTeacherProgramme, useTeacherProgrammeActions } from '../api';
import { teacherProgrammeViewOf } from '../gates';
import { OfferForm } from './OfferForm';
import { StopRequest } from './StopRequest';

const STATE_BADGE = {
  awaiting_offer: { label: 'programme.teacher.state.awaiting_offer', tone: 'neutral' },
  offered: { label: 'programme.teacher.state.offered', tone: 'warning' },
  active: { label: 'programme.teacher.state.active', tone: 'success' },
  paused: { label: 'programme.teacher.state.paused', tone: 'warning' },
  closed: { label: 'programme.teacher.state.closed', tone: 'neutral' },
} as const satisfies Readonly<
  Record<ProgrammeState, { label: MessageKey; tone: BadgeProps['tone'] }>
>;

export function TeacherProgrammePanel({
  enrollment,
}: {
  readonly enrollment: TeacherStudentsGetOutput;
}) {
  const marked = enrollment.programme !== undefined;
  const read = useTeacherProgramme(enrollment.enrollmentId, marked);
  if (!marked) return null;
  if (read.data !== undefined) {
    return <Programme enrollment={enrollment} programme={read.data} />;
  }
  if (read.isError) return <LoadError error={read.error} onRetry={() => void read.refetch()} />;
  return null;
}

/** An instant as a date and a time in the teacher's zone, else the sessions' (`common.format.dateTime`). */
function useWhen(fallbackZone: string): (instant: string) => string {
  const t = useT();
  const format = useFormatters();
  const zone = useMe().data?.timezone ?? fallbackZone;
  return (instant) =>
    t('common.format.dateTime', {
      date: format.date(instant, zone),
      time: format.time(instant, zone),
    });
}

function Programme({
  enrollment,
  programme,
}: {
  readonly enrollment: TeacherStudentsGetOutput;
  readonly programme: ProgrammeGetOutput;
}) {
  const t = useT();
  const actions = useTeacherProgrammeActions(enrollment.enrollmentId);
  const view = teacherProgrammeViewOf(programme);
  const when = useWhen(enrollment.sessions[0]?.timezone ?? 'UTC');
  const badge = STATE_BADGE[programme.state];
  return (
    <Card variant="surface">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space['3'],
        }}
      >
        <Text variant="headline">{t('programme.teacher.title')}</Text>
        <Badge label={t(badge.label)} tone={badge.tone} />
      </View>
      {view.payBlocked ? (
        <Banner icon={{ name: 'hourglass' }} tone="info">
          {t('programme.teacher.payBlocked')}
        </Banner>
      ) : null}
      {view.lateSince === null ? null : (
        <Banner icon={{ name: 'clock' }} tone="warning">
          {t('programme.teacher.lateSince', { when: when(view.lateSince) })}
        </Banner>
      )}
      {view.offerForm ? (
        <OfferForm
          terms={programme.offerTerms}
          offerDueAt={programme.offerDueAt}
          when={when}
          onSend={actions.offer}
        />
      ) : null}
      {view.running ? <Months programme={programme} when={when} /> : null}
      {view.sentOffer && programme.offer !== null ? (
        <SentOffer
          offer={programme.offer}
          monthCount={programme.monthCount}
          payBy={programme.payBy}
          when={when}
        />
      ) : null}
      <StopRequest programme={programme} onSend={actions.requestStop} />
    </Card>
  );
}

/** The months paid of the programme's months, and when the next is due (FR-726). */
function Months({
  programme,
  when,
}: {
  readonly programme: ProgrammeGetOutput;
  readonly when: (instant: string) => string;
}) {
  const t = useT();
  return (
    <View style={{ gap: tokens.space['1'] }}>
      {programme.monthCount === null ? null : (
        <Text variant="callout">
          {t('programme.teacher.months', {
            paid: programme.monthsPaid,
            count: programme.monthCount,
          })}
        </Text>
      )}
      {programme.nextDueAt === null ? null : (
        <Text variant="callout" tone="muted">
          {t('programme.teacher.nextDue', { when: when(programme.nextDueAt) })}
        </Text>
      )}
    </View>
  );
}

/** The offer as sent: the teacher's three texts, the sessions, the months, the total, the deadline. */
function SentOffer({
  offer,
  monthCount,
  payBy,
  when,
}: {
  readonly offer: ProgrammeOffer;
  readonly monthCount: number | null;
  readonly payBy: string | null;
  readonly when: (instant: string) => string;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const rows: { readonly label: string; readonly value: string; readonly kind?: 'total' }[] = [
    {
      label: t('programme.teacher.sent.sessions'),
      value: t('common.format.packageLine', {
        count: offer.sessionCount,
        minutes: offer.durationMinutes,
      }),
    },
    ...(monthCount === null
      ? []
      : [{ label: t('programme.teacher.offer.months'), value: format.number(monthCount) }]),
    ...(payBy === null ? [] : [{ label: t('programme.teacher.sent.payBy'), value: when(payBy) }]),
    {
      label: t('programme.teacher.offer.total'),
      value: formatPounds(piasters(offer.total_piasters), locale),
      kind: 'total',
    },
  ];
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Text variant="headline">{t('programme.teacher.sent.title')}</Text>
      <SentText label={t('programme.teacher.offer.level')} text={offer.level} />
      <SentText label={t('programme.teacher.offer.readiness')} text={offer.readiness} />
      <SentText label={t('programme.teacher.offer.expectedLength')} text={offer.expectedLength} />
      <Summary rows={rows} />
    </View>
  );
}

/** One of the offer's texts, under its label. */
function SentText({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <View style={{ gap: tokens.space['1'] }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="callout">{text}</Text>
    </View>
  );
}
