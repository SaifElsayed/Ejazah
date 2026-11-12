// T050 (FR-478, FR-451, FR-426, FR-467, FR-487, FR-493; R-MONEY-6; admin-surface.md, `cases.get`):
// a case's page beside the queue, `/cases?case=<id>`. The header names the case by its reason (a
// complaint by its kind), its state, its opening and its closing; then a complaint's text and its
// decision, a closed case's resolution and note; the enrollment with both parties (a deleted one by
// its stand-in, lane S's `PartyName`), its status, track, Teacher-No-Show count and mark (lane S's
// `NoShowMark`), with links to its sessions (`/sessions?enrollment=`) and to its orders on the
// payments monitor (`/payments?enrollment=`, from `paymentsLink`; Q6 (a)): never an amount here;
// what the case covers, each session by its number with its status and remedy; and, on an open
// case or complaint whose enrollment has a deleted party, that party's held files (lane S's
// `HeldFilesSection`, with this case's id). The footer offers what the server's answer allows: an
// open compensation case resolved or dismissed, an open complaint decided (never resolved or
// dismissed here), and on any case a manual case on its enrollment (lane S's `ManualCaseDialog`).
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  KeyValue,
  List,
  ListRow,
  Panel,
  Skeleton,
  TextLink,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { HeldFilesSection, ManualCaseDialog, NoShowMark, PartyName } from '../_shared';
import { type Closing, CloseCaseDialog, DecideComplaintDialog } from './CaseDialogs';
import { type CaseView, useCase, useCasesRefresh } from './queries';
import { CASE_STATUS, caseTitle, DECISION, REMEDY_KIND, REMEDY_STATUS, RESOLUTION } from './words';

type EnrollmentStatus = CaseView['enrollment']['status'];
type SessionStatus = CaseView['covers'][number]['status'];
type Track = CaseView['enrollment']['track'];

const ENROLLMENT_STATUS: Readonly<
  Record<
    EnrollmentStatus,
    { readonly label: MessageKey; readonly tone: 'warning' | 'success' | 'neutral' | 'danger' }
  >
> = {
  pending_payment: { label: 'admin.status.enrollment.pendingPayment', tone: 'warning' },
  confirmed: { label: 'admin.status.enrollment.confirmed', tone: 'success' },
  completed: { label: 'admin.status.enrollment.completed', tone: 'neutral' },
  terminated_no_show: { label: 'admin.status.enrollment.terminatedNoShow', tone: 'danger' },
  cancelled: { label: 'admin.status.enrollment.cancelled', tone: 'danger' },
};

const SESSION_STATUS: Readonly<Record<SessionStatus, MessageKey>> = {
  scheduled: 'admin.status.session.scheduled',
  done: 'admin.status.session.done',
  student_no_show: 'admin.status.session.studentNoShow',
  teacher_no_show: 'admin.status.session.teacherNoShow',
  both_no_show: 'admin.status.session.bothNoShow',
  under_threshold: 'admin.status.session.underThreshold',
  provider_outage: 'admin.status.session.providerOutage',
  cancelled_by_agreement: 'admin.status.session.cancelledByAgreement',
  cancelled_by_admin: 'admin.status.session.cancelledByAdmin',
  disputed: 'admin.status.session.disputed',
};

const TRACK: Readonly<Record<Track, MessageKey>> = {
  recitation: 'admin.status.track.recitation',
  ijazah_track: 'admin.status.track.ijazah',
};

export function CasePanel({ caseId }: { readonly caseId: string }) {
  const t = useT();
  const read = useCase(caseId);
  if (read.data !== undefined) return <CaseDetailPanel view={read.data} />;
  if (read.isError) {
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t('admin.common.loadError.text')}
      </Banner>
    );
  }
  return <Skeleton shape="block" />;
}

type Opened =
  { readonly kind: Closing } | { readonly kind: 'decide' } | { readonly kind: 'manual' };

function CaseDetailPanel({ view }: { readonly view: CaseView }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const refresh = useCasesRefresh();
  const [opened, setOpened] = useState<Opened | null>(null);
  const { case: detail, complaint, enrollment } = view;
  const at = (instant: string) =>
    t('admin.common.dateTime', {
      date: dayMonth(instant, locale, zone),
      time: timeOfDay(instant, locale, zone),
    });
  const status = CASE_STATUS[detail.status];
  const isOpen = detail.status === 'open';
  const isComplaint = detail.kind === 'absence_complaint';
  const partyDeleted = enrollment.student.deleted || enrollment.teacher.deleted;
  const enrollmentStatus = ENROLLMENT_STATUS[enrollment.status];
  const sessionsHref = `/sessions?enrollment=${enrollment.enrollmentId}`;
  const paymentsHref = `/payments?enrollment=${view.paymentsLink.enrollmentId}`;
  const closed = () => {
    setOpened(null);
    refresh();
  };

  return (
    <>
      <Panel
        header={
          <span className="stack grow">
            <strong className="text-title-3">{t(caseTitle(detail))}</strong>
            <span className="text-caption tone-muted">
              {t('admin.cases.openedAt', { date: at(detail.openedAt) })}
            </span>
            {detail.closedAt === undefined ? null : (
              <span className="text-caption tone-muted">
                {t('admin.cases.closedAt', { date: at(detail.closedAt) })}
              </span>
            )}
            <span className="self-start">
              <Badge label={t(status.label)} tone={status.tone} />
            </span>
          </span>
        }
        actions={
          <>
            {isOpen && !isComplaint ? (
              <>
                <Button
                  label={t('admin.cases.action.resolve')}
                  onPress={() => setOpened({ kind: 'resolve' })}
                />
                <Button
                  label={t('admin.cases.action.dismiss')}
                  variant="danger"
                  onPress={() => setOpened({ kind: 'dismiss' })}
                />
              </>
            ) : null}
            {isOpen && isComplaint ? (
              <Button
                label={t('admin.cases.action.decide')}
                onPress={() => setOpened({ kind: 'decide' })}
              />
            ) : null}
            <Button
              label={t('admin.cases.detail.openManual')}
              variant="secondary"
              onPress={() => setOpened({ kind: 'manual' })}
            />
          </>
        }
      >
        {complaint === undefined ? null : (
          <section className="section">
            <h2 className="group-label">{t('admin.cases.detail.complaintTitle')}</h2>
            <p className="text-callout">
              <UserText>{complaint.reason}</UserText>
            </p>
            <span className="text-caption tone-muted">
              {t('admin.cases.detail.raisedAt', { date: at(complaint.raisedAt) })}
            </span>
            {complaint.decision === undefined ? null : (
              <KeyValue
                items={[
                  {
                    label: t('admin.cases.detail.decisionLabel'),
                    value: t(DECISION[complaint.decision].label),
                  },
                ]}
              />
            )}
          </section>
        )}
        {isOpen ? null : (
          <section className="section">
            <h2 className="group-label">{t('admin.cases.detail.closingTitle')}</h2>
            {detail.resolution === undefined ? null : (
              <p className="text-callout">{t(RESOLUTION[detail.resolution])}</p>
            )}
            {detail.note === undefined ? null : (
              <KeyValue
                items={[
                  {
                    label: t('admin.cases.detail.note'),
                    value: <UserText>{detail.note}</UserText>,
                  },
                ]}
              />
            )}
          </section>
        )}
        <section className="section">
          <h2 className="group-label">{t('admin.cases.detail.enrollmentTitle')}</h2>
          <KeyValue
            items={[
              {
                label: t('admin.cases.detail.student'),
                value: <PartyName party={enrollment.student} role="student" />,
              },
              {
                label: t('admin.cases.detail.teacher'),
                value: <PartyName party={enrollment.teacher} role="teacher" />,
              },
              {
                label: t('admin.cases.detail.enrollmentStatus'),
                value: <Badge label={t(enrollmentStatus.label)} tone={enrollmentStatus.tone} />,
              },
              { label: t('admin.cases.detail.track'), value: t(TRACK[enrollment.track]) },
              {
                label: t('admin.cases.detail.noShows'),
                value: (
                  <NoShowMark
                    teacherNoShows={enrollment.teacherNoShows}
                    repeatedAbsence={enrollment.repeatedAbsence}
                  />
                ),
              },
            ]}
          />
          <span className="row wrap gap-4">
            <TextLink
              label={t('admin.cases.detail.sessionsLink')}
              href={sessionsHref}
              icon={{ name: 'chevron-right' }}
              onPress={() => void navigate(sessionsHref)}
            />
            <TextLink
              label={t('admin.common.action.openInPayments')}
              href={paymentsHref}
              icon={{ name: 'chevron-right' }}
              onPress={() => void navigate(paymentsHref)}
            />
          </span>
          <p className="text-caption tone-muted">{t('admin.cases.detail.paymentsNote')}</p>
        </section>
        <section className="section">
          <h2 className="group-label">{t('admin.cases.detail.coversTitle')}</h2>
          {view.covers.length === 0 ? (
            <p className="text-callout">{t('admin.cases.detail.coversEmpty')}</p>
          ) : (
            <List>
              {view.covers.map((covered) => (
                <ListRow
                  key={covered.sessionId}
                  label={
                    <span className="stack gap-half">
                      <span>
                        {t('admin.cases.detail.session', { number: covered.sequenceNumber })}
                      </span>
                      {covered.remedy === undefined ? null : (
                        <span className="row wrap gap-2 text-caption tone-muted">
                          <span>{t(REMEDY_KIND[covered.remedy.kind])}</span>
                          <span>{t(REMEDY_STATUS[covered.remedy.status])}</span>
                        </span>
                      )}
                    </span>
                  }
                  trailing={<Badge label={t(SESSION_STATUS[covered.status])} tone="neutral" />}
                />
              ))}
            </List>
          )}
        </section>
        {isOpen && partyDeleted ? <HeldFilesSection disputeId={detail.caseId} /> : null}
      </Panel>
      {opened === null ? null : opened.kind === 'manual' ? (
        <ManualCaseDialog
          enrollmentId={enrollment.enrollmentId}
          onDone={refresh}
          onClose={() => setOpened(null)}
        />
      ) : opened.kind === 'decide' ? (
        <DecideComplaintDialog
          caseId={detail.caseId}
          onDone={refresh}
          onClose={() => setOpened(null)}
        />
      ) : (
        <CloseCaseDialog
          kind={opened.kind}
          detail={detail}
          onDone={closed}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}
