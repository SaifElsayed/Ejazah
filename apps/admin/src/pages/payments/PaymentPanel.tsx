// T053 (FR-400, FR-401, `AdminPayments`): one gateway order beside the table. The header names the
// order, its student, package and teacher, and its status; then the amounts as the gateway reported
// them (a dash for one not reported, a paid order included), the gateway's references, the
// enrollment's package, status and progress, every paid order of the enrollment when it has more
// than one (a compensation case covers each, the note under T052), and the order's history as a
// timeline. The footer says no money moves here. There is no button: nothing on the monitor writes.
// B42, T047 (R-323 GAP-8): the enrollment's holds, oldest first as the server answered them, each
// placed and expiring, then released with its reason, a release with none read «not recorded», or
// not released.
import { piasters } from '@ijazah/money';

import {
  Badge,
  Banner,
  KeyValue,
  Panel,
  Skeleton,
  type StatusTone,
  Timeline,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonth, formatPounds, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { amountOrDash, HOLD_RELEASE_REASONS, orderHistory } from './history';
import { type PaymentDetail, type PaymentStatus, usePayment } from './queries';

/** Each status's word and tone, as the table and the panel draw it. */
export const PAYMENT_STATUS: Readonly<
  Record<PaymentStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  created: { label: 'admin.status.payment.created', tone: 'neutral' },
  paid: { label: 'admin.status.payment.paid', tone: 'success' },
  failed: { label: 'admin.status.payment.failed', tone: 'danger' },
  expired: { label: 'admin.status.payment.expired', tone: 'warning' },
  refunded: { label: 'admin.status.payment.refunded', tone: 'neutral' },
};

type EnrollmentStatus = NonNullable<PaymentDetail['enrollment']>['status'];

const ENROLLMENT_STATUS: Readonly<
  Record<EnrollmentStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  pending_payment: { label: 'admin.status.enrollment.pendingPayment', tone: 'warning' },
  confirmed: { label: 'admin.status.enrollment.confirmed', tone: 'success' },
  completed: { label: 'admin.status.enrollment.completed', tone: 'neutral' },
  terminated_no_show: { label: 'admin.status.enrollment.terminatedNoShow', tone: 'danger' },
  cancelled: { label: 'admin.status.enrollment.cancelled', tone: 'danger' },
};

export function PaymentPanel({ paymentId }: { readonly paymentId: string }) {
  const t = useT();
  const read = usePayment(paymentId);
  const loadFailure = errorMessageKey(read.error, 'admin.common.loadError.text');
  if (read.data !== undefined) return <PaymentDetailPanel detail={read.data} />;
  if (read.isError) {
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(loadFailure.key, loadFailure.values)}
      </Banner>
    );
  }
  return <Skeleton shape="block" />;
}

function PaymentDetailPanel({ detail }: { readonly detail: PaymentDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const { enrollment } = detail;
  const subjectName = (subject: { readonly nameAr: string; readonly nameEn: string }) =>
    locale === 'ar' ? subject.nameAr : subject.nameEn;
  const status = PAYMENT_STATUS[detail.status];
  const at = (value: string) =>
    t('admin.common.dateTime', {
      date: dayMonth(value, locale, zone),
      time: timeOfDay(value, locale, zone),
    });
  return (
    <Panel
      header={
        <span className="stack grow">
          <strong className="text-title-3">
            <bdi>{detail.gatewayOrderId}</bdi>
          </strong>
          {enrollment === undefined ? (
            <bdi className="text-caption tone-muted">{detail.student.displayName}</bdi>
          ) : (
            <span className="text-caption tone-muted">
              {t('admin.payments.detail.subtitle', {
                student: detail.student.displayName,
                subject: subjectName(enrollment.summary.subject),
                sessions: t('admin.common.sessions', { count: enrollment.summary.sessionCount }),
                teacher: enrollment.teacher.displayName,
              })}
            </span>
          )}
          <span className="self-start">
            <Badge label={t(status.label)} tone={status.tone} />
          </span>
        </span>
      }
      note={t('admin.payments.detail.footer')}
    >
      <section className="section">
        <h2 className="group-label">{t('admin.payments.detail.amountsTitle')}</h2>
        <KeyValue
          columns={3}
          items={[
            {
              label: t('admin.payments.detail.gross'),
              value: formatPounds(piasters(detail.gross_piasters), locale),
            },
            {
              label: t('admin.payments.detail.gatewayFee'),
              value: amountOrDash(
                detail.gatewayFee_piasters === undefined
                  ? undefined
                  : piasters(detail.gatewayFee_piasters),
                locale,
                t,
              ),
            },
            {
              label: t('admin.payments.detail.netToTeacher'),
              value: amountOrDash(
                detail.net_piasters === undefined ? undefined : piasters(detail.net_piasters),
                locale,
                t,
              ),
            },
            // 003:T104 (ADR 0025 D1): the teacher's share kept on the order, with its rate; no line
            // for an order created before the commission, which keeps neither.
            ...(detail.teacherShare_piasters === undefined ||
            detail.teacherShareRatePercent === undefined
              ? []
              : [
                  {
                    label: t('admin.payments.detail.teacherShare'),
                    value: t('admin.payments.teacherShare', {
                      amount: formatPounds(piasters(detail.teacherShare_piasters), locale),
                      percent: detail.teacherShareRatePercent,
                    }),
                  },
                ]),
          ]}
        />
      </section>
      <section className="section">
        <h2 className="group-label">{t('admin.payments.detail.referencesTitle')}</h2>
        <KeyValue
          items={[
            {
              label: t('admin.payments.detail.orderNo'),
              value: <bdi>{detail.gatewayOrderId}</bdi>,
            },
            {
              label: t('admin.payments.detail.transactionNo'),
              value:
                detail.gatewayTransactionId === undefined ? (
                  t('admin.payments.dash')
                ) : (
                  <bdi>{detail.gatewayTransactionId}</bdi>
                ),
            },
          ]}
        />
      </section>
      {enrollment === undefined ? null : (
        <section className="section">
          <h2 className="group-label">
            {t('admin.payments.detail.enrollment', {
              subject: subjectName(enrollment.summary.subject),
              sessions: t('admin.common.sessions', { count: enrollment.summary.sessionCount }),
            })}
          </h2>
          <span className="row wrap gap-2">
            <Badge
              label={t(ENROLLMENT_STATUS[enrollment.status].label)}
              tone={ENROLLMENT_STATUS[enrollment.status].tone}
            />
            <span className="text-callout">
              {t('admin.common.progress', { done: enrollment.completed, total: enrollment.total })}
            </span>
          </span>
        </section>
      )}
      {enrollment === undefined ? null : (
        <section className="section" aria-label={t('admin.payments.detail.holdsTitle')}>
          <h2 className="group-label">{t('admin.payments.detail.holdsTitle')}</h2>
          {enrollment.holds.length === 0 ? (
            <p className="text-callout tone-muted">{t('admin.payments.detail.holdsEmpty')}</p>
          ) : (
            <ul className="stack gap-2">
              {enrollment.holds.map((hold) => (
                <li key={hold.holdId} className="stack text-callout">
                  <span>
                    {t('admin.payments.detail.holdPlaced', {
                      placed: at(hold.placedAt),
                      expires: at(hold.expiresAt),
                    })}
                  </span>
                  <span className="text-caption tone-muted">
                    {hold.releasedAt === undefined
                      ? t('admin.payments.detail.holdNotReleased')
                      : t('admin.payments.detail.holdReleased', {
                          released: at(hold.releasedAt),
                          reason:
                            hold.releaseReason === undefined
                              ? t('admin.payments.detail.holdReasonNotRecorded')
                              : t(HOLD_RELEASE_REASONS[hold.releaseReason]),
                        })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {detail.paidOrders.length > 1 ? (
        <section className="section">
          <h2 className="group-label">{t('admin.payments.detail.paidOrdersTitle')}</h2>
          <p className="text-caption tone-muted">{t('admin.payments.detail.paidOrdersNote')}</p>
          <ul className="stack gap-2">
            {detail.paidOrders.map((order) => (
              <li key={order.paymentId} className="row gap-2 text-callout">
                <bdi>{order.gatewayOrderId}</bdi>
                <Badge
                  label={t(PAYMENT_STATUS[order.status].label)}
                  tone={PAYMENT_STATUS[order.status].tone}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="section" aria-label={t('admin.payments.detail.a11yEvents')}>
        <h2 className="group-label">{t('admin.payments.detail.eventsTitle')}</h2>
        <Timeline items={orderHistory(detail, t, locale, zone)} />
      </section>
    </Panel>
  );
}
