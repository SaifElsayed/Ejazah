// 006:T021 (FR-706a, FR-706b, FR-709, FR-725 to FR-727; SRS DEC-112, DEC-113; B-P4's conflict check
// Q-1 (a) amended, Q-8 (b); admin-surface.md `programmes.get`): one programme beside the queue, as
// `programmes.get` answers it. The header names its two parties and its state. Then its terms: the
// offer's and the payment's deadlines, the offer (count, length, total, the teacher's words), how
// the rest is paid, the months paid of the count, the next month due, the pause and the close, and
// whether a card is saved (a yes or no, never a card detail, SC-707). Its orders by kind, each with
// its month, how it was paid, its decline, its status and its link to the monitor (the amounts are
// the monitor's). Its items with their reasons: the teacher's on a stop, the one recorded at the
// decision on a `no_offer` item (FR-727). An open item says why it opened, a `pay_blocked` one
// whether the payout account is verified now (the queue's row, when the page was opened from it),
// and each decision it takes with what it does (`KIND_DECISIONS`; an extension's hours read from its
// setting, or the setting named when they cannot be read). Where the assessment was not held (an
// open `no_offer` item's, or a closed programme's with no `assessment` release): the fee unreleased,
// the fee the student's, the fee's order, and the button that opens a compensation case for the
// student, the party locked (Q-8 (b)); no case opens by itself, a decision included. A programme
// an approved stop closed can be reopened (FR-727), with a mandatory reason.
import { piasters } from '@ijazah/money';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  KeyValue,
  Panel,
  Skeleton,
  TextLink,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear, formatPounds, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { ManualCaseDialog } from '../_shared';
import { DecisionDialog } from '../gender/DecisionDialog';
import { orderTerms, PAYMENT_STATUS } from '../payments/PaymentPanel';
import { labelKey } from '../settings/words';
import { DecideDialog } from './DecideDialog';
import {
  type ProgrammeDetail,
  type ProgrammeQueueRow,
  type ProgrammeRequest,
  useExtendHours,
  useProgramme,
  useProgrammeActions,
} from './queries';
import {
  type ExtendSetting,
  KIND_DECISIONS,
  type KindDecision,
  PROGRAMME_STATE,
  REQUEST_KIND,
  REQUEST_STATUS,
  reopenFailure,
  WHY_OPENED,
} from './words';

export interface ProgrammePanelProps {
  readonly enrollmentId: string;
  /** The queue's row of this programme, when the page was opened from it. */
  readonly queued?: ProgrammeQueueRow;
}

export function ProgrammePanel({ enrollmentId, queued }: ProgrammePanelProps) {
  const t = useT();
  const read = useProgramme(enrollmentId);
  if (read.data !== undefined) {
    return <ProgrammeRecord programme={read.data} {...(queued === undefined ? {} : { queued })} />;
  }
  if (read.isError) {
    const failure = errorMessageKey(read.error, 'admin.common.loadError.text');
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(failure.key, failure.values)}
      </Banner>
    );
  }
  return <Skeleton shape="block" />;
}

interface Deciding {
  readonly request: ProgrammeRequest;
  readonly choice: KindDecision;
}

function ProgrammeRecord({
  programme,
  queued,
}: {
  readonly programme: ProgrammeDetail;
  readonly queued?: ProgrammeQueueRow;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const actions = useProgrammeActions();
  const [deciding, setDeciding] = useState<Deciding | null>(null);
  const [reopening, setReopening] = useState(false);
  const [compensating, setCompensating] = useState(false);
  const open = programme.requests.filter((request) => request.status === 'open');
  const hours = useExtendHours(
    open.some((request) => KIND_DECISIONS[request.kind].some((one) => one.window !== undefined)),
  );
  const state = PROGRAMME_STATE[programme.state];
  const at = (value: string) =>
    t('admin.common.dateTime', {
      date: dayMonthYear(value, locale, zone),
      time: timeOfDay(value, locale, zone),
    });
  const windowOf = (setting: ExtendSetting) => {
    const value = hours[setting];
    return value === undefined
      ? t('admin.programme.effects.windowOfSetting', { setting: t(labelKey(setting)) })
      : t('admin.programme.effects.window', { hours: value });
  };
  const notHeld =
    programme.assessmentHeld === false ||
    open.some((request) => request.kind === 'no_offer' && request.assessmentHeld === false);
  const assessmentOrder = programme.orders.find((order) => order.kind === 'assessment');
  const stoppedByItsStop =
    programme.state === 'closed' &&
    programme.requests.some((request) => request.kind === 'stop' && request.status === 'approved');
  const monthsValue =
    programme.monthCount === null
      ? String(programme.monthsPaid)
      : t('admin.programme.detail.monthsOf', {
          paid: programme.monthsPaid,
          count: programme.monthCount,
        });
  const planValue =
    programme.plan === null
      ? t('admin.programme.detail.planNone')
      : t(
          programme.plan === 'in_full'
            ? 'admin.programme.detail.planInFull'
            : 'admin.programme.detail.planMonthly',
        );
  const dated = (label: MessageKey, value: string | null) =>
    value === null ? [] : [{ label: t(label), value: at(value) }];

  return (
    <>
      <Panel
        header={
          <span className="stack grow">
            <strong className="text-title-3">
              <UserText>{programme.student.displayName}</UserText>
            </strong>
            <span className="text-caption tone-muted">
              {t('admin.programme.row.teacher', { name: programme.teacher.displayName })}
            </span>
            <span className="self-start">
              <Badge label={t(state.label)} tone={state.tone} />
            </span>
          </span>
        }
      >
        <section className="section">
          <KeyValue
            columns={2}
            items={[
              ...dated('admin.programme.detail.offerDueAt', programme.offerDueAt),
              ...dated('admin.programme.detail.payBy', programme.payBy),
              { label: t('admin.programme.detail.plan'), value: planValue },
              { label: t('admin.programme.detail.months'), value: monthsValue },
              ...dated('admin.programme.detail.nextDueAt', programme.nextDueAt),
              ...dated('admin.programme.detail.pausedAt', programme.pausedAt),
              ...dated('admin.programme.detail.closedAt', programme.closedAt),
              {
                label: t('admin.programme.detail.cardSaved'),
                value: t(programme.cardSaved ? 'admin.common.yes' : 'admin.common.no'),
              },
            ]}
          />
        </section>
        {programme.offer === null ? null : (
          <section className="section">
            <h2 className="group-label">{t('admin.programme.detail.offer')}</h2>
            <p className="text-callout">
              {t('admin.programme.detail.offerTerms', {
                sessions: t('admin.common.sessions', { count: programme.offer.sessionCount }),
                minutes: t('admin.common.minutes', { count: programme.offer.durationMinutes }),
                total: formatPounds(piasters(programme.offer.total_piasters), locale),
              })}
            </p>
            <KeyValue
              items={[
                {
                  label: t('admin.programme.detail.offerLevel'),
                  value: <UserText>{programme.offer.level}</UserText>,
                },
                {
                  label: t('admin.programme.detail.offerReadiness'),
                  value: <UserText>{programme.offer.readiness}</UserText>,
                },
                {
                  label: t('admin.programme.detail.offerExpectedLength'),
                  value: <UserText>{programme.offer.expectedLength}</UserText>,
                },
              ]}
            />
          </section>
        )}
        {notHeld ? (
          <section className="section">
            <Banner icon={{ name: 'triangle-alert' }} tone="warning">
              {t('admin.programme.compensation.notHeld')}
            </Banner>
            <p className="text-callout">{t('admin.programme.compensation.feeIsStudents')}</p>
            <span className="row wrap gap-2">
              {assessmentOrder === undefined ? null : (
                <TextLink
                  label={t('admin.common.action.openInPayments')}
                  href={`/payments?payment=${assessmentOrder.paymentId}`}
                  onPress={() => void navigate(`/payments?payment=${assessmentOrder.paymentId}`)}
                />
              )}
              <Button
                label={t('admin.programme.compensation.open')}
                icon={{ name: 'scale' }}
                variant="secondary"
                onPress={() => setCompensating(true)}
              />
            </span>
          </section>
        ) : null}
        <section className="section">
          <h2 className="group-label">{t('admin.programme.detail.requestsTitle')}</h2>
          {programme.requests.length === 0 ? (
            <p className="text-callout tone-muted">{t('admin.programme.detail.requestsEmpty')}</p>
          ) : (
            <ul className="stack gap-4">
              {programme.requests.map((request) => (
                <RequestItem
                  key={request.requestId}
                  request={request}
                  at={at}
                  payeeVerifiedNow={
                    queued?.request?.requestId === request.requestId
                      ? queued.payeeVerifiedNow
                      : null
                  }
                  windowOf={windowOf}
                  onDecide={(choice) => setDeciding({ request, choice })}
                />
              ))}
            </ul>
          )}
        </section>
        {stoppedByItsStop ? (
          <section className="section">
            <p className="text-callout">{t('admin.programme.reopen.explain')}</p>
            <span className="row wrap gap-2">
              <Button
                label={t('admin.programme.reopen.action')}
                icon={{ name: 'rotate-ccw' }}
                variant="secondary"
                onPress={() => setReopening(true)}
              />
            </span>
          </section>
        ) : null}
        <section className="section">
          <h2 className="group-label">{t('admin.programme.detail.ordersTitle')}</h2>
          <p className="text-caption tone-muted">{t('admin.programme.detail.ordersNote')}</p>
          {programme.orders.length === 0 ? (
            <p className="text-callout tone-muted">{t('admin.programme.detail.ordersEmpty')}</p>
          ) : (
            <ul className="stack gap-2">
              {programme.orders.map((order) => {
                const terms = orderTerms(order, t);
                const href = `/payments?payment=${order.paymentId}`;
                return (
                  <li key={order.paymentId} className="stack text-callout">
                    <span className="row wrap gap-2">
                      <strong className="text-medium">{terms.kind}</strong>
                      {order.instalmentMonth === undefined ? null : <span>{terms.month}</span>}
                      <Badge
                        label={t(PAYMENT_STATUS[order.status].label)}
                        tone={PAYMENT_STATUS[order.status].tone}
                      />
                      {order.declineKind === undefined ? null : (
                        <span className="text-caption">{terms.declineKind}</span>
                      )}
                    </span>
                    <span className="row wrap gap-2 text-caption tone-muted">
                      {order.automatic ? (
                        <Badge label={t('admin.payments.columns.automatic')} tone="neutral" />
                      ) : null}
                      <span>{at(order.createdAt)}</span>
                      <TextLink
                        label={t('admin.common.action.openInPayments')}
                        href={href}
                        onPress={() => void navigate(href)}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Panel>
      {deciding === null ? null : (
        <DecideDialog
          requestId={deciding.request.requestId}
          choice={deciding.choice}
          needsReason={deciding.request.kind === 'no_offer'}
          window={
            deciding.choice.window === undefined ? undefined : windowOf(deciding.choice.window)
          }
          onClose={() => setDeciding(null)}
        />
      )}
      {reopening ? (
        <DecisionDialog
          title={t('admin.programme.reopen.title')}
          icon="rotate-ccw"
          tone="primary"
          effects={[
            t('admin.programme.reopen.effects.paused'),
            t('admin.programme.reopen.effects.time'),
          ]}
          reasonLabel={t('admin.programme.reopen.reasonLabel')}
          confirm={t('admin.programme.reopen.confirm')}
          run={(reason, _extra, key) => actions.reopen(programme.enrollmentId, reason, key)}
          failureOf={reopenFailure}
          onClose={() => setReopening(false)}
        />
      ) : null}
      {compensating ? (
        <ManualCaseDialog
          enrollmentId={programme.enrollmentId}
          party="student"
          onClose={() => setCompensating(false)}
        />
      ) : null}
    </>
  );
}

function RequestItem({
  request,
  at,
  payeeVerifiedNow,
  windowOf,
  onDecide,
}: {
  readonly request: ProgrammeRequest;
  readonly at: (value: string) => string;
  readonly payeeVerifiedNow: boolean | null;
  readonly windowOf: (setting: ExtendSetting) => string;
  readonly onDecide: (choice: KindDecision) => void;
}) {
  const t = useT();
  const status = REQUEST_STATUS[request.status];
  const isOpen = request.status === 'open';
  const why = WHY_OPENED[request.kind];
  const decisions = isOpen ? KIND_DECISIONS[request.kind] : [];
  const reasonLabel: MessageKey | null =
    request.kind === 'stop'
      ? 'admin.programme.detail.stopReason'
      : request.kind === 'no_offer'
        ? 'admin.programme.detail.noOfferReason'
        : null;
  return (
    <li className="stack gap-2">
      <span className="row wrap gap-2">
        <strong className="text-medium">{t(REQUEST_KIND[request.kind])}</strong>
        <Badge label={t(status.label)} tone={status.tone} />
      </span>
      <span className="row wrap gap-2 text-caption tone-muted">
        <span>{t('admin.programme.row.openedAt', { date: at(request.createdAt) })}</span>
        {request.decidedAt === undefined ? null : (
          <span>{t('admin.programme.detail.decidedAt', { date: at(request.decidedAt) })}</span>
        )}
      </span>
      {reasonLabel === null || request.reason === undefined ? null : (
        <KeyValue
          items={[{ label: t(reasonLabel), value: <UserText>{request.reason}</UserText> }]}
        />
      )}
      {isOpen && why !== null ? <p className="text-callout">{t(why)}</p> : null}
      {isOpen && request.kind === 'pay_blocked' && payeeVerifiedNow !== null ? (
        <p className="text-callout">
          {t(
            payeeVerifiedNow
              ? 'admin.programme.payeeNow.verified'
              : 'admin.programme.payeeNow.unverified',
          )}
        </p>
      ) : null}
      {decisions.length === 0 ? null : (
        <section className="section" aria-label={t('admin.programme.detail.decisionsTitle')}>
          <h3 className="group-label">{t('admin.programme.detail.decisionsTitle')}</h3>
          {decisions.map((choice) => {
            const window = choice.window === undefined ? undefined : windowOf(choice.window);
            return (
              <div key={choice.decision} className="stack gap-1">
                <span className="self-start">
                  <Button
                    label={t(choice.label)}
                    variant={choice.decision === 'approve' ? 'primary' : 'secondary'}
                    onPress={() => onDecide(choice)}
                  />
                </span>
                {choice.effects.map((effect) => (
                  <span key={effect} className="text-caption">
                    {t(effect, window === undefined ? undefined : { window })}
                  </span>
                ))}
                {choice.beside === undefined ? null : (
                  <span className="text-caption text-medium">{t(choice.beside)}</span>
                )}
              </div>
            );
          })}
        </section>
      )}
    </li>
  );
}
