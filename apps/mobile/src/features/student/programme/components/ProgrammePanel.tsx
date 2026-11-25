// 006:T019 (FR-706, FR-706b, FR-710, FR-713, FR-713a, FR-715, FR-716, FR-726, FR-BOOK-19): the
// student's programme on the enrollment's page (`IjazahRequestPanel`'s pattern: a card, its badge,
// its lines and its buttons), read from `programme.get`; what it offers is `gates.ts`'s. The offer:
// the teacher's three texts, the sessions, the months, the deadline as a date and a time in the
// student's zone and the total; «pay in full» or «pay monthly», the consent (FR-713) on «monthly»
// only and unticked; the cancellation behind a dialog. A running programme: the months paid and the
// next due; «renew now», «pay now», «change card»; the automatic renewal's off row behind a dialog.
// The lines: paused since when, the teacher unavailable, `payBlocked`, `payeePending`,
// `chargePending`. A payment opens the gateway's hosted page through the checkout's `hosted.ts`;
// `PREVIOUS_CHECKOUT` goes to `CheckoutPrevious` as the booking sheet does (FR-BOOK-12); any other
// refusal is said in place, and the panel is read again. A read refused NOT_FOUND is no programme:
// nothing is drawn.
import type {
  ProgrammeCard,
  ProgrammeGetOutput,
  ProgrammeOffer,
  ProgrammePlan,
  ProgrammeState,
} from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Badge,
  type BadgeProps,
  Banner,
  Button,
  Card,
  CheckRow,
  Dialog,
  Segmented,
  Summary,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useLocale, useT } from '../../../../i18n';
import { errorCodeOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { LoadError } from '../../../shared/states';
import { openHostedCheckout } from '../../checkout/hosted';
import { useProgramme, useProgrammeActions } from '../api';
import {
  type OfferView,
  payInputOf,
  programmeViewOf,
  type RenewalButton,
  type RenewalView,
  renewInputOf,
} from '../gates';

/** FR-BOOK-12's screen, as the booking sheet reaches it. */
const CHECKOUT_PREVIOUS_ROUTE = '/(student)/checkout/previous';

const STATE_BADGE = {
  awaiting_offer: { label: 'programme.student.state.awaiting_offer', tone: 'neutral' },
  offered: { label: 'programme.student.state.offered', tone: 'warning' },
  active: { label: 'programme.student.state.active', tone: 'success' },
  paused: { label: 'programme.student.state.paused', tone: 'warning' },
  closed: { label: 'programme.student.state.closed', tone: 'neutral' },
} as const satisfies Readonly<
  Record<ProgrammeState, { label: MessageKey; tone: BadgeProps['tone'] }>
>;

const RENEWAL_BUTTON = {
  renewNow: { label: 'programme.student.renew.now', variant: 'primary' },
  payNow: { label: 'programme.student.renew.payNow', variant: 'primary' },
  changeCard: { label: 'programme.student.renew.changeCard', variant: 'secondary' },
} as const satisfies Readonly<
  Record<RenewalButton, { label: MessageKey; variant: 'primary' | 'secondary' }>
>;

type Busy = 'pay' | RenewalButton | 'cancel' | 'autoRenewOff' | null;

export function ProgrammePanel({
  enrollmentId,
  track,
  zone,
}: {
  readonly enrollmentId: string;
  readonly track: string;
  /** The student's zone, every date and time is shown in. */
  readonly zone: string;
}) {
  const read = useProgramme(enrollmentId, track === 'ijazah_track');
  if (read.data !== undefined) {
    return <Programme enrollmentId={enrollmentId} programme={read.data} zone={zone} />;
  }
  if (read.isError && errorCodeOf(read.error) !== 'NOT_FOUND') {
    return <LoadError error={read.error} onRetry={() => void read.refetch()} />;
  }
  return null;
}

function Programme({
  enrollmentId,
  programme,
  zone,
}: {
  readonly enrollmentId: string;
  readonly programme: ProgrammeGetOutput;
  readonly zone: string;
}) {
  const t = useT();
  const actions = useProgrammeActions(enrollmentId);
  const view = programmeViewOf(programme);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const when = useWhen(zone);
  const badge = STATE_BADGE[programme.state];

  async function act(what: Exclude<Busy, null>, send: () => Promise<unknown>): Promise<void> {
    setBusy(what);
    setFailure(null);
    try {
      await send();
    } catch (caught: unknown) {
      if (errorCodeOf(caught) === 'PREVIOUS_CHECKOUT') router.push(CHECKOUT_PREVIOUS_ROUTE);
      else setFailure(genericErrorKey(caught, 'common.state.actionError'));
    } finally {
      setBusy(null);
    }
  }
  /** A payment: the hosted page of the order the server made, then `processing`. */
  const checkout = (what: Exclude<Busy, null>, order: () => Promise<{ checkoutUrl: string }>) =>
    act(what, async () => {
      const { checkoutUrl } = await order();
      await openHostedCheckout(checkoutUrl, enrollmentId);
    });

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
        <Text variant="headline">{t('programme.student.title')}</Text>
        <Badge label={t(badge.label)} tone={badge.tone} />
      </View>
      {view.unavailable ? (
        <Banner icon={{ name: 'user-x' }} tone="warning">
          {t('programme.student.unavailable')}
        </Banner>
      ) : null}
      {view.pausedSince === null ? null : (
        <Banner icon={{ name: 'clock' }} tone="warning">
          {t('programme.student.paused', { when: when(view.pausedSince) })}
        </Banner>
      )}
      {view.offer === null || programme.offer === null ? null : (
        <OfferPart
          offer={programme.offer}
          payBy={programme.payBy}
          monthCount={programme.monthCount}
          view={view.offer}
          zone={zone}
          busy={busy}
          onPay={(plan, consent) => {
            const input = payInputOf(plan, consent);
            void checkout('pay', () => actions.pay(input.plan, input.saveCard));
          }}
          onCancel={() => void act('cancel', actions.cancel)}
        />
      )}
      {view.renewal === null ? null : (
        <RenewalPart
          programme={programme}
          view={view.renewal}
          zone={zone}
          busy={busy}
          onRenew={(button) =>
            void checkout(button, () => actions.renew(renewInputOf(button).saveCard))
          }
        />
      )}
      {view.autoRenewOff ? (
        <AutoRenewRow
          card={programme.card}
          busy={busy === 'autoRenewOff'}
          onTurnOff={() => void act('autoRenewOff', actions.autoRenewOff)}
        />
      ) : null}
      {failure === null ? null : (
        <Banner icon={{ name: 'triangle-alert' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Card>
  );
}

/** An instant as a date and a time in `zone` (`common.format.dateTime`). */
function useWhen(zone: string): (instant: string) => string {
  const t = useT();
  const format = useFormatters();
  return (instant) =>
    t('common.format.dateTime', { date: format.date(instant, zone), time: format.time(instant, zone) });
}

function OfferPart({
  offer,
  payBy,
  monthCount,
  view,
  zone,
  busy,
  onPay,
  onCancel,
}: {
  readonly offer: ProgrammeOffer;
  readonly payBy: string | null;
  readonly monthCount: number | null;
  readonly view: OfferView;
  readonly zone: string;
  readonly busy: Busy;
  readonly onPay: (plan: ProgrammePlan, consent: boolean) => void;
  readonly onCancel: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const when = useWhen(zone);
  const [cancelling, setCancelling] = useState(false);
  const rows: { readonly label: string; readonly value: string; readonly kind?: 'total' }[] = [
    {
      label: t('programme.student.offer.sessions'),
      value: t('common.format.packageLine', {
        count: offer.sessionCount,
        minutes: offer.durationMinutes,
      }),
    },
    ...(monthCount === null
      ? []
      : [{ label: t('programme.student.offer.months'), value: format.number(monthCount) }]),
    ...(payBy === null ? [] : [{ label: t('programme.student.offer.payBy'), value: when(payBy) }]),
    {
      label: t('programme.student.offer.total'),
      value: formatPounds(piasters(offer.total_piasters), locale),
      kind: 'total',
    },
  ];
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Text variant="headline">{t('programme.student.offer.title')}</Text>
      <OfferText label={t('programme.student.offer.level')} text={offer.level} />
      <OfferText label={t('programme.student.offer.readiness')} text={offer.readiness} />
      <OfferText label={t('programme.student.offer.expectedLength')} text={offer.expectedLength} />
      <Summary rows={rows} />
      {view.line === null ? null : (
        <Banner icon={{ name: view.line === 'payBlocked' ? 'hourglass' : 'info' }} tone="info">
          {t(`programme.student.${view.line}`)}
        </Banner>
      )}
      {view.pay ? <PayChoice busy={busy === 'pay'} onPay={onPay} /> : null}
      {view.cancel ? (
        <Button
          label={t('programme.student.cancel.action')}
          variant="danger"
          layout="block"
          loading={busy === 'cancel'}
          onPress={() => setCancelling(true)}
        />
      ) : null}
      <Dialog
        open={cancelling}
        title={t('programme.student.cancel.dialog.title')}
        actions={[
          {
            label: t('programme.student.cancel.dialog.keep'),
            variant: 'secondary',
            onPress: () => setCancelling(false),
          },
          {
            label: t('programme.student.cancel.dialog.confirm'),
            variant: 'danger',
            onPress: () => {
              setCancelling(false);
              onCancel();
            },
          },
        ]}
      >
        {t('programme.student.cancel.dialog.text')}
      </Dialog>
    </View>
  );
}

/** One of the teacher's texts, under its label. */
function OfferText({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <View style={{ gap: tokens.space['1'] }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="callout">{text}</Text>
    </View>
  );
}

/** In full or monthly; the consent on «monthly» only, unticked until the student ticks it. */
function PayChoice({
  busy,
  onPay,
}: {
  readonly busy: boolean;
  readonly onPay: (plan: ProgrammePlan, consent: boolean) => void;
}) {
  const t = useT();
  const [plan, setPlan] = useState<ProgrammePlan>('in_full');
  const [consent, setConsent] = useState(false);
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Segmented
        accessibilityLabel={t('programme.student.pay.plan')}
        options={[
          { value: 'in_full', label: t('programme.student.pay.planInFull') },
          { value: 'monthly', label: t('programme.student.pay.planMonthly') },
        ]}
        value={plan}
        onChange={(value) => setPlan(value === 'monthly' ? 'monthly' : 'in_full')}
      />
      {plan === 'monthly' ? (
        <CheckRow
          label={t('programme.student.consent')}
          checked={consent}
          onChange={setConsent}
          top
        />
      ) : null}
      <Button
        label={t(plan === 'monthly' ? 'programme.student.pay.monthly' : 'programme.student.pay.inFull')}
        layout="block"
        loading={busy}
        onPress={() => onPay(plan, consent)}
      />
    </View>
  );
}

function RenewalPart({
  programme,
  view,
  zone,
  busy,
  onRenew,
}: {
  readonly programme: ProgrammeGetOutput;
  readonly view: RenewalView;
  readonly zone: string;
  readonly busy: Busy;
  readonly onRenew: (button: RenewalButton) => void;
}) {
  const t = useT();
  const when = useWhen(zone);
  return (
    <View style={{ gap: tokens.space['3'] }}>
      {programme.monthCount === null ? null : (
        <Text variant="callout">
          {t('programme.student.months', {
            paid: programme.monthsPaid,
            count: programme.monthCount,
          })}
        </Text>
      )}
      {programme.nextDueAt === null ? null : (
        <Text variant="callout" tone="muted">
          {t('programme.student.nextDue', { when: when(programme.nextDueAt) })}
        </Text>
      )}
      {view.chargeLine ? (
        <Banner icon={{ name: 'hourglass' }} tone="info">
          {t('programme.student.chargePending')}
        </Banner>
      ) : null}
      {view.payeeLine ? (
        <Banner icon={{ name: 'info' }} tone="info">
          {t('programme.student.payeePending')}
        </Banner>
      ) : null}
      {view.buttons.map((button) => (
        <Button
          key={button}
          label={t(RENEWAL_BUTTON[button].label)}
          variant={RENEWAL_BUTTON[button].variant}
          layout="block"
          loading={busy === button}
          onPress={() => onRenew(button)}
        />
      ))}
    </View>
  );
}

/**
 * The automatic renewal on the saved card, by its brand and last four; turned off behind a dialog.
 * Shown only where `gates.ts` says a card is saved, so the row's presence is the gate's alone.
 */
function AutoRenewRow({
  card,
  busy,
  onTurnOff,
}: {
  readonly card: ProgrammeCard | null;
  readonly busy: boolean;
  readonly onTurnOff: () => void;
}) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  return (
    <View style={{ gap: tokens.space['2'] }}>
      {card === null ? null : (
        <Text variant="callout" tone="muted">
          {t('programme.student.autoRenew.cardLine', { brand: card.brand, last4: card.last4 })}
        </Text>
      )}
      <Button
        label={t('programme.student.autoRenew.off')}
        variant="secondary"
        layout="block"
        loading={busy}
        onPress={() => setAsking(true)}
      />
      <Dialog
        open={asking}
        title={t('programme.student.autoRenew.dialog.title')}
        actions={[
          {
            label: t('programme.student.autoRenew.dialog.keep'),
            variant: 'secondary',
            onPress: () => setAsking(false),
          },
          {
            label: t('programme.student.autoRenew.dialog.confirm'),
            variant: 'danger',
            onPress: () => {
              setAsking(false);
              onTurnOff();
            },
          },
        ]}
      >
        {t('programme.student.autoRenew.dialog.text')}
      </Dialog>
    </View>
  );
}

