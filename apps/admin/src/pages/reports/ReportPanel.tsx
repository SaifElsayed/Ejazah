// 005:T023 (B49; FR-612, FR-614; the note under T023, Q-R1 (a)): one report beside the list, as
// `reports.get` answers it. The header names its context and status; the reported person and the
// reporter (links to their records), the date, and the evidence: a session or chat report's
// enrollment (`/sessions?enrollment=`), a profile report none; the reporter's words; once settled,
// the decision's date and note. While it is open: «action taken» or «dismissed», each with its
// mandatory note (FR-612), and «open a gender dispute», which raises a gender flag on the reported
// person from this report (`genderFlags.raise` with `reportId`, FR-614).
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
import { UserText } from '../../i18n/UserText';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { DecisionDialog } from '../gender/DecisionDialog';
import { PersonLink } from '../gender/PersonLink';
import { RaiseFlagDialog } from '../gender/RaiseFlagDialog';
import { type ReportDetail, useReport, useReportActions } from './queries';
import { REPORT_CONTEXT, REPORT_STATUS, reportFailure } from './words';

export function ReportPanel({ reportId }: { readonly reportId: string }) {
  const t = useT();
  const read = useReport(reportId);
  if (read.data !== undefined) return <ReportRecord report={read.data} />;
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

type Acting = 'actioned' | 'dismissed' | 'raise';

function ReportRecord({ report }: { readonly report: ReportDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const actions = useReportActions();
  const [acting, setActing] = useState<Acting | null>(null);
  const status = REPORT_STATUS[report.status];
  const evidenceHref =
    report.enrollmentId === null ? null : `/sessions?enrollment=${report.enrollmentId}`;
  const close = () => setActing(null);

  return (
    <>
      <Panel
        header={
          <span className="row wrap gap-2 grow">
            <strong className="text-title-3">{t(REPORT_CONTEXT[report.context])}</strong>
            <Badge label={t(status.label)} tone={status.tone} />
          </span>
        }
      >
        <section className="section">
          <KeyValue
            columns={2}
            items={[
              {
                label: t('admin.reports.detail.reported'),
                value: <PersonLink userId={report.reportedUserId} />,
              },
              {
                label: t('admin.reports.detail.reporter'),
                value: <PersonLink userId={report.reporterUserId} />,
              },
              {
                label: t('admin.reports.detail.sentAt'),
                value: dayMonthYear(report.createdAt, locale, zone),
              },
              {
                label: t('admin.reports.detail.evidence'),
                value:
                  evidenceHref === null ? (
                    t('admin.payments.dash')
                  ) : (
                    <TextLink
                      label={t('admin.reports.detail.openEnrollment')}
                      href={evidenceHref}
                      onPress={() => void navigate(evidenceHref)}
                    />
                  ),
              },
            ]}
          />
        </section>
        <section className="section">
          <h2 className="group-label">{t('admin.reports.detail.reason')}</h2>
          <p className="text-callout">
            <UserText>{report.reason}</UserText>
          </p>
        </section>
        {report.resolution === null ? null : (
          <section className="section">
            <KeyValue
              columns={2}
              items={[
                {
                  label: t('admin.reports.detail.decision'),
                  value: t('admin.reports.detail.decidedOn', {
                    date: dayMonthYear(report.resolution.resolvedAt, locale, zone),
                  }),
                },
                {
                  label: t('admin.reports.detail.note'),
                  value:
                    report.resolution.note === null ? (
                      t('admin.payments.dash')
                    ) : (
                      <UserText>{report.resolution.note}</UserText>
                    ),
                },
              ]}
            />
          </section>
        )}
        {report.status === 'open' ? (
          <section className="section">
            <span className="row wrap gap-2">
              <Button
                label={t('admin.reports.detail.action')}
                variant="primary"
                onPress={() => setActing('actioned')}
              />
              <Button
                label={t('admin.reports.detail.dismiss')}
                variant="secondary"
                onPress={() => setActing('dismissed')}
              />
              <Button
                label={t('admin.reports.detail.openGenderFlag')}
                variant="secondary"
                onPress={() => setActing('raise')}
              />
            </span>
          </section>
        ) : null}
      </Panel>
      {acting === 'actioned' ? (
        <DecisionDialog
          title={t('admin.dialogs.confirm.actionReport.title')}
          icon="circle-check"
          tone="primary"
          effects={[t('admin.dialogs.confirm.actionReport.effects.closed')]}
          reasonLabel={t('admin.dialogs.confirm.actionReport.reasonLabel')}
          confirm={t('admin.dialogs.confirm.actionReport.confirm')}
          run={(note, _extra, key) => actions.resolve(report.reportId, 'actioned', note, key)}
          failureOf={reportFailure}
          onClose={close}
        />
      ) : null}
      {acting === 'dismissed' ? (
        <DecisionDialog
          title={t('admin.dialogs.confirm.dismissReport.heading')}
          icon="circle-x"
          tone="primary"
          effects={[t('admin.dialogs.confirm.dismissReport.effects.closed')]}
          reasonLabel={t('admin.dialogs.confirm.dismissReport.reasonLabel')}
          confirm={t('admin.dialogs.confirm.dismissReport.confirm')}
          run={(note, _extra, key) => actions.resolve(report.reportId, 'dismissed', note, key)}
          failureOf={reportFailure}
          onClose={close}
        />
      ) : null}
      {acting === 'raise' ? (
        <RaiseFlagDialog
          fromReport={{ reportId: report.reportId, reportedUserId: report.reportedUserId }}
          onClose={close}
        />
      ) : null}
    </>
  );
}
