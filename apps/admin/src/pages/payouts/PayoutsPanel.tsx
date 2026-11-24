// 003:T105 (SRS DEC-89; the note under T105, Q-6 as revised): one teacher's payouts beside the table,
// as `payouts.get` answers them. The header names the teacher and his payout account masked (or
// says none is verified); his five figures; «ليه», one row per release with its part, amount and
// state (held with when it falls due, or waiting for an open case; due since when; paid with its
// date), and the order and the student behind it (the order opens on the payments monitor); «عليه»,
// one row per refund on his orders with the refund as recorded, his share of it, and the closing
// case's reason with its link (`/cases?case=`). Each release row ends with its actions: «تم الصرف»
// on a written due row (`MarkDialog`); a due release the sweep has not written yet says it will be;
// «التراجع عن الصرف» on a written paid row (`UnmarkDialog`; the owner's «موافق», 2026-11-18).
import { type Piasters, piasters } from '@ijazah/money';
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
import { useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonth, formatPounds, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { MarkDialog } from './MarkDialog';
import { UnmarkDialog } from './UnmarkDialog';
import {
  type PayoutDeductionRow,
  type PayoutReleaseRow,
  type PayoutsDetail,
  useTeacherPayouts,
} from './queries';
import { caseReasonLabel, PART, STATE } from './words';

export function PayoutsPanel({ teacherUserId }: { readonly teacherUserId: string }) {
  const t = useT();
  const read = useTeacherPayouts(teacherUserId);
  if (read.data !== undefined) return <TeacherPayoutsPanel detail={read.data} />;
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

/** The release open in «تم الصرف»'s or «التراجع عن الصرف»'s dialog, with its words. */
interface Marking {
  readonly kind: 'mark' | 'unmark';
  readonly releaseId: string;
  readonly lead: string;
}

function TeacherPayoutsPanel({ detail }: { readonly detail: PayoutsDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const [marking, setMarking] = useState<Marking | null>(null);
  const pounds = (amount_piasters: Piasters) => formatPounds(amount_piasters, locale);
  const when = (instant: string) =>
    t('admin.common.dateTime', {
      date: dayMonth(instant, locale, zone),
      time: timeOfDay(instant, locale, zone),
    });
  const link = (label: string, href: string) => (
    <TextLink label={label} href={href} onPress={() => void navigate(href)} />
  );

  /** When the release falls or fell due, or when it was paid. */
  const stateLine = (release: PayoutReleaseRow): string => {
    switch (release.state) {
      case 'held':
        if (release.waitsForCase) return t('admin.money.payouts.detail.heldWaitsForCase');
        return release.fallsDueAt === undefined
          ? t('admin.money.payouts.detail.heldAfterLast')
          : t('admin.money.payouts.detail.heldUntil', { when: when(release.fallsDueAt) });
      case 'due':
        return release.fallsDueAt === undefined
          ? t('admin.money.payouts.state.due')
          : t('admin.money.payouts.detail.dueSince', { when: when(release.fallsDueAt) });
      case 'paid':
        return release.paidAt === undefined
          ? t('admin.money.payouts.state.paid')
          : t('admin.money.payouts.detail.paidOn', { when: when(release.paidAt) });
    }
  };

  /** What the administrator can do on a release row, by its state. */
  const actionsOf = (release: PayoutReleaseRow) => {
    if (release.state === 'held') return null;
    if (release.releaseId === undefined) {
      return release.state === 'due' ? (
        <span className="text-caption tone-muted">
          {t('admin.money.payouts.detail.dueNotWritten')}
        </span>
      ) : null;
    }
    const { releaseId } = release;
    const lead = t('admin.money.payouts.mark.lead', {
      part: t(PART[release.part]),
      amount: pounds(piasters(release.amount_piasters)),
    });
    return release.state === 'due' ? (
      <Button
        label={t('admin.money.payouts.mark.action')}
        variant="primary"
        onPress={() => setMarking({ kind: 'mark', releaseId, lead })}
      />
    ) : (
      <Button
        label={t('admin.money.payouts.unmark.action')}
        variant="secondary"
        onPress={() => setMarking({ kind: 'unmark', releaseId, lead })}
      />
    );
  };

  const releaseItem = (release: PayoutReleaseRow, index: number) => {
    const state = STATE[release.state];
    const actions = actionsOf(release);
    return (
      <li
        key={release.releaseId ?? `${release.part}-${release.enrollmentId}-${index}`}
        className="stack gap-1 text-callout"
      >
        <span className="row wrap gap-2">
          <strong>{t(PART[release.part])}</strong>
          <span>{pounds(piasters(release.amount_piasters))}</span>
          <Badge label={t(state.label)} tone={state.tone} />
        </span>
        <span className="text-caption tone-muted">{stateLine(release)}</span>
        <span className="row wrap gap-2 text-caption">
          <bdi>
            {t('admin.money.payouts.detail.student', { name: release.student.displayName })}
          </bdi>
          {release.orders.length > 1
            ? null
            : link(
                t('admin.common.action.openInPayments'),
                // PR #160 r1 Minor 5: the one order the release draws from, else the release's own.
                `/payments?payment=${release.orders[0]?.paymentId ?? release.paymentId}`,
              )}
        </span>
        {/* 006:T018 (FU-E1): a release drawn from more than one paid order lists each, with its amount. */}
        {release.orders.length > 1 ? (
          <span className="stack gap-1 text-caption">
            <span className="tone-muted">{t('admin.money.payouts.detail.drawnTitle')}</span>
            <span className="row wrap gap-2">
              {release.orders.map((order) => (
                <span key={order.paymentId}>
                  {link(
                    t('admin.money.payouts.detail.drawnFrom', {
                      amount: pounds(piasters(order.amount_piasters)),
                    }),
                    `/payments?payment=${order.paymentId}`,
                  )}
                </span>
              ))}
            </span>
          </span>
        ) : null}
        {actions === null ? null : <span className="row wrap gap-2">{actions}</span>}
      </li>
    );
  };

  const deductionItem = (deduction: PayoutDeductionRow) => (
    <li key={deduction.paymentId} className="stack gap-1 text-callout">
      <span className="row wrap gap-2">
        <span>
          {t('admin.money.payouts.detail.refunded', {
            amount: pounds(piasters(deduction.refunded_piasters)),
          })}
        </span>
        <strong>
          {t('admin.money.payouts.detail.share', {
            amount: pounds(piasters(deduction.share_piasters)),
          })}
        </strong>
      </span>
      {/* 003:T127 (SRS DEC-98): a refund after the end release, the platform's, not the teacher's. */}
      {deduction.platformShare_piasters === undefined ? null : (
        <span className="text-caption tone-muted">
          {t('admin.money.payouts.detail.platformShare', {
            amount: pounds(piasters(deduction.platformShare_piasters)),
          })}
        </span>
      )}
      {deduction.case === undefined ? (
        <span className="text-caption tone-muted">{t('admin.money.payouts.detail.noCase')}</span>
      ) : (
        <span className="row wrap gap-2 text-caption">
          <span>
            {t('admin.money.payouts.detail.reason', {
              reason: t(caseReasonLabel(deduction.case.reason)),
            })}
          </span>
          {link(t('admin.money.payouts.detail.openCase'), `/cases?case=${deduction.case.caseId}`)}
        </span>
      )}
      <span className="row wrap gap-2 text-caption">
        <bdi>
          {t('admin.money.payouts.detail.student', { name: deduction.student.displayName })}
        </bdi>
        {link(t('admin.common.action.openInPayments'), `/payments?payment=${deduction.paymentId}`)}
      </span>
    </li>
  );

  const { figures } = detail;
  return (
    <>
      <Panel
        header={
          <strong className="text-title-3 grow">
            <bdi>{detail.teacher.displayName}</bdi>
          </strong>
        }
      >
        <section className="section">
          <KeyValue
            columns={3}
            items={[
              {
                label: t('admin.money.payouts.detail.payoutAccount'),
                value:
                  detail.payoutAccountMasked === undefined ? (
                    t('admin.money.payouts.detail.payoutAccountNone')
                  ) : (
                    <bdi>{detail.payoutAccountMasked}</bdi>
                  ),
              },
              {
                label: t('admin.money.payouts.totals.held'),
                value: pounds(piasters(figures.held_piasters)),
              },
              {
                label: t('admin.money.payouts.totals.dueNow'),
                value: pounds(piasters(figures.dueNow_piasters)),
              },
              {
                label: t('admin.money.payouts.totals.paid'),
                value: pounds(piasters(figures.paid_piasters)),
              },
              {
                label: t('admin.money.payouts.totals.paidThisMonth'),
                value: pounds(piasters(figures.paidThisMonth_piasters)),
              },
              {
                label: t('admin.money.payouts.totals.takenOff'),
                value: pounds(piasters(figures.takenOff_piasters)),
              },
            ]}
          />
        </section>
        <section className="section" aria-label={t('admin.money.payouts.detail.releasesTitle')}>
          <h2 className="group-label">{t('admin.money.payouts.detail.releasesTitle')}</h2>
          <p className="text-caption tone-muted">{t('admin.money.payouts.detail.releasesLede')}</p>
          {detail.releases.length === 0 ? (
            <p className="text-callout tone-muted">
              {t('admin.money.payouts.detail.releasesEmpty')}
            </p>
          ) : (
            <ul className="stack gap-3">{detail.releases.map(releaseItem)}</ul>
          )}
        </section>
        <section className="section" aria-label={t('admin.money.payouts.detail.deductionsTitle')}>
          <h2 className="group-label">{t('admin.money.payouts.detail.deductionsTitle')}</h2>
          <p className="text-caption tone-muted">
            {t('admin.money.payouts.detail.deductionsLede')}
          </p>
          {detail.deductions.length === 0 ? (
            <p className="text-callout tone-muted">
              {t('admin.money.payouts.detail.deductionsEmpty')}
            </p>
          ) : (
            <ul className="stack gap-3">{detail.deductions.map(deductionItem)}</ul>
          )}
        </section>
      </Panel>
      {marking?.kind === 'mark' ? (
        <MarkDialog
          releaseId={marking.releaseId}
          teacher={detail.teacher.displayName}
          lead={marking.lead}
          onClose={() => setMarking(null)}
        />
      ) : null}
      {marking?.kind === 'unmark' ? (
        <UnmarkDialog
          releaseId={marking.releaseId}
          teacher={detail.teacher.displayName}
          lead={marking.lead}
          onClose={() => setMarking(null)}
        />
      ) : null}
    </>
  );
}
