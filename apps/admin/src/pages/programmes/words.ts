// 006:T021 (FR-727; SRS DEC-112, DEC-113; admin-surface.md `programmes.*`): what `/programmes` says,
// each by what the server answered. The queue's tabs are the contract's filters but `refusal`, which
// no item uses since SRS DEC-112 (the value stays in the contract, R-API-9). A programme's state, an
// item's kind and status, and each kind's decisions as `programmes.decide` takes them (`ALLOWED`,
// `programme-requests.service.ts`): a `stop` approve or decline; a `no_offer` or `pay_blocked`
// approve or extend; a `charge_unknown` approve or extend only, with no «confirm paid» (a payment is
// confirmed only by the gateway, R-HONEST-1, ADR 0026). Each decision with its effects, one line
// each. A refused decision or reopen by its cause (`CONFLICT` with one of the contract's refusals),
// `NOT_FOUND`, and `RATE_LIMITED` with when to try again through T058's `errorMessageKey`, which
// keeps the generic words for any other failure.
import type {
  ProgrammeRequestItem,
  ProgrammesDecideRefusal,
  ProgrammesDecision,
  ProgrammesQueueFilter,
  ProgrammesReopenRefusal,
} from '@ijazah/contracts/admin';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import type { ProgrammeDetail } from './queries';

type State = ProgrammeDetail['state'];
type Kind = ProgrammeRequestItem['kind'];
type RequestStatus = ProgrammeRequestItem['status'];

/** The queue's tabs, in the task's order; no `refusal` tab (SRS DEC-112). */
export const QUEUE_TABS: readonly {
  readonly filter: ProgrammesQueueFilter;
  readonly label: MessageKey;
  readonly explain: MessageKey;
}[] = [
  {
    filter: 'paused',
    label: 'admin.programme.tabs.paused',
    explain: 'admin.programme.explain.paused',
  },
  { filter: 'stop', label: 'admin.programme.tabs.stop', explain: 'admin.programme.explain.stop' },
  {
    filter: 'no_offer',
    label: 'admin.programme.tabs.noOffer',
    explain: 'admin.programme.explain.noOffer',
  },
  {
    filter: 'pay_blocked',
    label: 'admin.programme.tabs.payBlocked',
    explain: 'admin.programme.explain.payBlocked',
  },
  {
    filter: 'charge_unknown',
    label: 'admin.programme.tabs.chargeUnknown',
    explain: 'admin.programme.explain.chargeUnknown',
  },
];

export const PROGRAMME_STATE: Readonly<
  Record<State, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  awaiting_offer: { label: 'admin.programme.state.awaitingOffer', tone: 'warning' },
  offered: { label: 'admin.programme.state.offered', tone: 'warning' },
  active: { label: 'admin.programme.state.active', tone: 'success' },
  paused: { label: 'admin.programme.state.paused', tone: 'danger' },
  closed: { label: 'admin.programme.state.closed', tone: 'neutral' },
};

export const REQUEST_KIND: Readonly<Record<Kind, MessageKey>> = {
  stop: 'admin.programme.kind.stop',
  refusal: 'admin.programme.kind.refusal',
  no_offer: 'admin.programme.kind.noOffer',
  pay_blocked: 'admin.programme.kind.payBlocked',
  charge_unknown: 'admin.programme.kind.chargeUnknown',
};

export const REQUEST_STATUS: Readonly<
  Record<RequestStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  open: { label: 'admin.programme.requestStatus.open', tone: 'warning' },
  approved: { label: 'admin.programme.requestStatus.approved', tone: 'success' },
  declined: { label: 'admin.programme.requestStatus.declined', tone: 'neutral' },
  withdrawn: { label: 'admin.programme.requestStatus.withdrawn', tone: 'neutral' },
  extended: { label: 'admin.programme.requestStatus.extended', tone: 'neutral' },
};

/** Why an open item opened, in its own words. */
export const WHY_OPENED: Readonly<Record<Kind, MessageKey | null>> = {
  stop: 'admin.programme.why.stop',
  refusal: null,
  no_offer: 'admin.programme.why.noOffer',
  pay_blocked: 'admin.programme.why.payBlocked',
  charge_unknown: 'admin.programme.why.chargeUnknown',
};

/** The setting whose hours an extension gives (admin-surface.md `programmes.decide`). */
export type ExtendSetting = 'programme_offer_hours' | 'programme_pay_rest_hours';

/** One decision a kind takes: its button, its effects, the extension's setting. */
export interface KindDecision {
  readonly decision: ProgrammesDecision;
  readonly label: MessageKey;
  readonly effects: readonly MessageKey[];
  /** An extension's hours, read from this setting and said in its effect's `{window}`. */
  readonly window?: ExtendSetting;
  /** A line said beside the decision (the owner's, on a `charge_unknown` extension). */
  readonly beside?: MessageKey;
}

/** The decisions each kind takes, as the server's `ALLOWED` holds them; none on `refusal`. */
export const KIND_DECISIONS: Readonly<Record<Kind, readonly KindDecision[]>> = {
  stop: [
    {
      decision: 'approve',
      label: 'admin.programme.decision.stop.approve',
      effects: [
        'admin.programme.effects.stop.approve.close',
        'admin.programme.effects.stop.approve.card',
      ],
    },
    {
      decision: 'decline',
      label: 'admin.programme.decision.stop.decline',
      effects: ['admin.programme.effects.stop.decline.stays'],
    },
  ],
  refusal: [],
  no_offer: [
    {
      decision: 'approve',
      label: 'admin.programme.decision.noOffer.approve',
      effects: [
        'admin.programme.effects.noOffer.approve.close',
        'admin.programme.effects.noOffer.approve.fee',
        'admin.programme.effects.noOffer.approve.time',
      ],
    },
    {
      decision: 'extend',
      label: 'admin.programme.decision.noOffer.extend',
      effects: [
        'admin.programme.effects.noOffer.extend.more',
        'admin.programme.effects.noOffer.extend.time',
      ],
      window: 'programme_offer_hours',
    },
  ],
  pay_blocked: [
    {
      decision: 'approve',
      label: 'admin.programme.decision.payBlocked.approve',
      effects: [
        'admin.programme.effects.payBlocked.approve.lapse',
        'admin.programme.effects.payBlocked.approve.fee',
      ],
    },
    {
      decision: 'extend',
      label: 'admin.programme.decision.payBlocked.extend',
      effects: [
        'admin.programme.effects.payBlocked.extend.more',
        'admin.programme.effects.payBlocked.extend.time',
      ],
      window: 'programme_pay_rest_hours',
    },
  ],
  charge_unknown: [
    {
      decision: 'approve',
      label: 'admin.programme.decision.chargeUnknown.approve',
      effects: [
        'admin.programme.effects.chargeUnknown.approve.expired',
        'admin.programme.effects.chargeUnknown.approve.retries',
      ],
    },
    {
      decision: 'extend',
      label: 'admin.programme.decision.chargeUnknown.extend',
      effects: ['admin.programme.effects.chargeUnknown.extend.asking'],
      beside: 'admin.programme.effects.chargeUnknown.paidInPaymob',
    },
  ],
};

const DECIDE_REFUSED: Readonly<Record<ProgrammesDecideRefusal, MessageKey>> = {
  not_open: 'admin.programme.decide.refused.notOpen',
  decision_not_allowed: 'admin.programme.decide.refused.decisionNotAllowed',
  not_offered: 'admin.programme.decide.refused.notOffered',
  offer_sent: 'admin.programme.decide.refused.offerSent',
  reason_required: 'admin.programme.decide.refused.reasonRequired',
  makeup_pending: 'admin.programme.decide.refused.makeupPending',
  sessions_pending: 'admin.programme.decide.refused.sessionsPending',
  charge_answered: 'admin.programme.decide.refused.chargeAnswered',
};

const REOPEN_REFUSED: Readonly<Record<ProgrammesReopenRefusal, MessageKey>> = {
  slot_taken: 'admin.programme.reopen.refused.slotTaken',
  party_restricted: 'admin.programme.reopen.refused.partyRestricted',
  gender_mismatch: 'admin.programme.reopen.refused.genderMismatch',
  not_stopped: 'admin.programme.reopen.refused.notStopped',
  slot_inactive: 'admin.programme.reopen.refused.slotInactive',
  time_taken: 'admin.programme.reopen.refused.timeTaken',
};

function failureBy(
  refused: Readonly<Record<string, MessageKey>>,
  notFound: MessageKey,
): (error: unknown) => ErrorMessage {
  return (error) => {
    switch (errorCodeOf(error)) {
      case 'NOT_FOUND':
        return { key: notFound };
      case 'CONFLICT': {
        const known = errorDetailsOf(error).find(({ code }) => Object.hasOwn(refused, code));
        return {
          key: known === undefined ? 'admin.shared.keyReused' : (refused[known.code] as MessageKey),
        };
      }
      default:
        return errorMessageKey(error, 'admin.dialogs.submitError');
    }
  };
}

/** The words of a refused decision. */
export const decideFailure = failureBy(DECIDE_REFUSED, 'admin.programme.decide.refused.notFound');

/** The words of a refused reopen. */
export const reopenFailure = failureBy(REOPEN_REFUSED, 'admin.programme.reopen.refused.notFound');
