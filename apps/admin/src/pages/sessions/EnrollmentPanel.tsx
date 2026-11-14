// B42, T047 (FR-479, FR-460, FR-454, FR-439, FR-493, FR-451, FR-426; R-MONEY-6; R-323 GAP-1, GAP-2,
// GAP-4): one enrollment beside the monitor's list, as `sessions.monitor.get` answers it.
// - The header names its parties (a deleted one's stand-in, `PartyName`/`partyLabel`), its status
//   and its Teacher-No-Show count and mark (`NoShowMark`), the server's figures.
// - Its sessions by number, each in its own zone with its city and in the panel's, its status (the
//   outcome a dispute holds), the session it makes up for, and its remedy: the state, the offer and
//   the choice's deadline, the proposal, a pending counter-proposal with the teacher's answer
//   deadline, the decision, «booking refused, retried until …», and its case's link.
// - Its compensation cases, each linking to `/cases?case=`, and its timeline, newest first as the
//   server answered it.
// - Each session no longer scheduled links to its telemetry, `/review?session=` (GAP-2).
// - The actions, each shown only while the server's field allows it and each a dialog with its
//   reason: the cancellation (`cancellable`), the correction (`correctable`, lane S's dialog), the
//   restore (`restorableUntil`, saying until when), and the manual case (lane S's dialog) on the
//   enrollment and beside each open remedy with its `remedyId`. A hidden button is never the
//   enforcement: the server's refusal is.
// - Payment status only as a link to `/payments?enrollment=`; no amount anywhere (FR-479).
// - B42b, T075 (FR-503, FR-454 as amended; SRS FR-CANCEL-9, DEC-69; N11): the restore stays offered
//   while `restorableUntil` is answered, past or not (a restore is possible at any time); its words
//   say the slot is held until `slotHeldUntil` or was released at `slotReleasedAt`; «تحرير الموعد»
//   on a held slot, while the server answers `slotHeldUntil`.
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
import { panelTimeZone } from '../../lib/zone';
import { CorrectionDialog, ManualCaseDialog, NoShowMark, partyLabel, PartyName } from '../_shared';
import {
  type MonitorDetail,
  type MonitoredRemedy,
  type MonitoredSession,
  useMonitoredEnrollment,
  useRereadMonitor,
} from './queries';
import { CancelSessionDialog, ReleaseSlotDialog, RestoreDialog } from './SessionDialogs';
import {
  CASE_REASON,
  CASE_STATUS,
  ENROLLMENT_STATUS,
  eventWords,
  instant,
  isOpenRemedy,
  ownTime,
  panelTime,
  REMEDY_KIND,
  REMEDY_STATUS,
  SESSION_STATUS,
  type SlotHold,
  slotHoldOf,
  TRACK,
} from './words';

export function EnrollmentPanel({ enrollmentId }: { readonly enrollmentId: string }) {
  const t = useT();
  const read = useMonitoredEnrollment(enrollmentId);
  const loadFailure = errorMessageKey(read.error, 'admin.common.loadError.text');
  if (read.data !== undefined) return <EnrollmentDetail detail={read.data} />;
  if (read.isError) {
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(loadFailure.key, loadFailure.values)}
      </Banner>
    );
  }
  return <Skeleton shape="block" />;
}

/** The dialog open on the panel, if any. */
type Opened =
  | { readonly action: 'cancel'; readonly session: MonitoredSession }
  | { readonly action: 'correct'; readonly sessionId: string }
  | { readonly action: 'restore'; readonly hold: SlotHold }
  | { readonly action: 'release'; readonly until: string }
  | { readonly action: 'case'; readonly remedyId?: string };

function EnrollmentDetail({ detail }: { readonly detail: MonitorDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const reread = useRereadMonitor();
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = () => setOpened(null);
  const { enrollment } = detail;
  const numbers = new Map(detail.sessions.map((each) => [each.sessionId, each.sequenceNumber]));
  const status = ENROLLMENT_STATUS[enrollment.status];
  const paymentsHref = `/payments?enrollment=${enrollment.enrollmentId}`;
  const link = (href: string) => () => void navigate(href);
  const { restorableUntil, slotHeldUntil } = enrollment;
  // T075 (N11): the hold's words; the restore's button reads `restorableUntil` alone.
  const hold = slotHoldOf(enrollment);

  return (
    <>
      <Panel
        header={
          <span className="stack grow gap-1">
            <strong className="text-title-3">
              {t('admin.sessions.detail.heading', {
                student: partyLabel(enrollment.student, 'student', t),
                teacher: partyLabel(enrollment.teacher, 'teacher', t),
              })}
            </strong>
            <span className="row wrap gap-2">
              <Badge label={t(status.label)} tone={status.tone} />
              <NoShowMark
                teacherNoShows={enrollment.teacherNoShows}
                repeatedAbsence={enrollment.repeatedAbsence}
              />
            </span>
          </span>
        }
        actions={
          <span className="row wrap gap-2">
            <TextLink
              label={t('admin.sessions.detail.payments')}
              href={paymentsHref}
              onPress={link(paymentsHref)}
            />
            <Button
              label={t('admin.sessions.detail.openCase')}
              variant="secondary"
              onPress={() => setOpened({ action: 'case' })}
            />
            {slotHeldUntil === undefined ? null : (
              <Button
                label={t('admin.sessions.detail.release')}
                variant="secondary"
                onPress={() => setOpened({ action: 'release', until: slotHeldUntil })}
              />
            )}
            {restorableUntil === undefined || hold === undefined ? null : (
              <Button
                label={t('admin.sessions.detail.restore')}
                onPress={() => setOpened({ action: 'restore', hold })}
              />
            )}
          </span>
        }
        note={t('admin.sessions.detail.footer')}
      >
        <section className="section">
          <KeyValue
            items={[
              {
                label: t('admin.sessions.detail.student'),
                value: <PartyName party={enrollment.student} role="student" />,
              },
              {
                label: t('admin.sessions.detail.teacher'),
                value: <PartyName party={enrollment.teacher} role="teacher" />,
              },
              { label: t('admin.sessions.detail.track'), value: t(TRACK[enrollment.track]) },
              {
                label: t('admin.sessions.detail.progress'),
                value: t('admin.sessions.progress', {
                  done: enrollment.completed,
                  total: enrollment.sessionCount,
                  remaining: enrollment.remaining,
                }),
              },
            ]}
          />
          {restorableUntil === undefined || hold === undefined ? null : (
            <p className="text-callout">
              {hold.state === 'held'
                ? t('admin.sessions.detail.restorableUntil', {
                    when: instant(hold.until, t, locale, zone),
                  })
                : t('admin.sessions.detail.slotReleased', {
                    when: instant(hold.at, t, locale, zone),
                  })}
            </p>
          )}
        </section>
        <section className="section" aria-label={t('admin.sessions.detail.sessionsTitle')}>
          <h2 className="group-label">{t('admin.sessions.detail.sessionsTitle')}</h2>
          {detail.sessions.length === 0 ? (
            <p className="text-callout tone-muted">{t('admin.sessions.detail.sessionsEmpty')}</p>
          ) : (
            <ul className="stack gap-4">
              {detail.sessions.map((each) => (
                <SessionRow
                  key={each.sessionId}
                  session={each}
                  onCancel={() => setOpened({ action: 'cancel', session: each })}
                  onCorrect={() => setOpened({ action: 'correct', sessionId: each.sessionId })}
                  onHandToCase={(remedyId) => setOpened({ action: 'case', remedyId })}
                />
              ))}
            </ul>
          )}
        </section>
        <section className="section" aria-label={t('admin.sessions.detail.casesTitle')}>
          <h2 className="group-label">{t('admin.sessions.detail.casesTitle')}</h2>
          {detail.cases.length === 0 ? (
            <p className="text-callout tone-muted">{t('admin.sessions.detail.casesEmpty')}</p>
          ) : (
            <ul className="stack gap-2">
              {detail.cases.map((each) => {
                const href = `/cases?case=${each.caseId}`;
                const drawn = CASE_STATUS[each.status];
                return (
                  <li key={each.caseId} className="row wrap gap-2 text-callout">
                    <span>{t(CASE_REASON[each.reason])}</span>
                    <Badge label={t(drawn.label)} tone={drawn.tone} />
                    <TextLink
                      label={t('admin.sessions.detail.viewCase')}
                      href={href}
                      onPress={link(href)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="section" aria-label={t('admin.sessions.detail.timelineTitle')}>
          <h2 className="group-label">{t('admin.sessions.detail.timelineTitle')}</h2>
          {detail.events.length === 0 ? (
            <p className="text-callout tone-muted">{t('admin.sessions.detail.timelineEmpty')}</p>
          ) : (
            <ol className="stack gap-2">
              {detail.events.map((event, index) => {
                const words = eventWords(event, numbers, t, locale, zone);
                return (
                  // The server's order is the timeline's; two rows may share a kind and an instant.
                  <li key={index} className="stack">
                    <strong className="text-callout">{words.title}</strong>
                    {words.detail === undefined ? null : (
                      <span className="text-caption">{words.detail}</span>
                    )}
                    <span className="text-caption tone-muted">
                      {instant(event.occurredAt, t, locale, zone)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </Panel>
      {opened?.action === 'cancel' ? (
        <CancelSessionDialog
          sessionId={opened.session.sessionId}
          sequenceNumber={opened.session.sequenceNumber}
          onClose={close}
        />
      ) : null}
      {opened?.action === 'correct' ? (
        <CorrectionDialog
          sessionId={opened.sessionId}
          onDone={() => {
            void reread();
            close();
          }}
          onClose={close}
        />
      ) : null}
      {opened?.action === 'restore' ? (
        <RestoreDialog enrollmentId={enrollment.enrollmentId} hold={opened.hold} onClose={close} />
      ) : null}
      {opened?.action === 'release' ? (
        <ReleaseSlotDialog
          enrollmentId={enrollment.enrollmentId}
          slotHeldUntil={opened.until}
          onClose={close}
        />
      ) : null}
      {opened?.action === 'case' ? (
        <ManualCaseDialog
          enrollmentId={enrollment.enrollmentId}
          {...(opened.remedyId === undefined ? {} : { remedyId: opened.remedyId })}
          onDone={() => void reread()}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function SessionRow({
  session,
  onCancel,
  onCorrect,
  onHandToCase,
}: {
  readonly session: MonitoredSession;
  readonly onCancel: () => void;
  readonly onCorrect: () => void;
  readonly onHandToCase: (remedyId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const drawn = SESSION_STATUS[session.status];
  const telemetryHref = `/review?session=${session.sessionId}`;
  return (
    <li
      className="stack gap-2"
      aria-label={t('admin.sessions.detail.session', { n: session.sequenceNumber })}
    >
      <span className="row wrap gap-2">
        <strong className="text-callout">
          {t('admin.sessions.detail.session', { n: session.sequenceNumber })}
        </strong>
        <Badge label={t(drawn.label)} tone={drawn.tone} />
      </span>
      {session.makeupFor === undefined ? null : (
        <span className="text-caption tone-muted">
          {t('admin.sessions.detail.makeupFor', { n: session.makeupFor.sequenceNumber })}
        </span>
      )}
      <span className="stack">
        <span className="text-callout">{ownTime(session, t, locale)}</span>
        <span className="text-caption tone-muted">
          {panelTime(session.startsAt, t, locale, zone)}
        </span>
      </span>
      {session.outcomeUnderDispute === undefined ? null : (
        <span className="text-caption">
          {t('admin.sessions.detail.underDispute', {
            outcome: t(SESSION_STATUS[session.outcomeUnderDispute].label),
          })}
        </span>
      )}
      {session.remedy === undefined ? null : (
        <RemedyBlock remedy={session.remedy} onHandToCase={onHandToCase} />
      )}
      <span className="row wrap gap-2">
        {session.cancellable ? (
          <Button
            label={t('admin.sessions.detail.cancel')}
            variant="secondary"
            onPress={onCancel}
          />
        ) : null}
        {session.correctable ? (
          <Button
            label={t('admin.sessions.detail.correct')}
            variant="secondary"
            onPress={onCorrect}
          />
        ) : null}
        {session.status === 'scheduled' ? null : (
          <TextLink
            label={t('admin.sessions.detail.telemetry')}
            href={telemetryHref}
            onPress={() => void navigate(telemetryHref)}
          />
        )}
      </span>
    </li>
  );
}

function RemedyBlock({
  remedy,
  onHandToCase,
}: {
  readonly remedy: MonitoredRemedy;
  readonly onHandToCase: (remedyId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const when = (value: string) => instant(value, t, locale, zone);
  const caseHref = remedy.caseId === undefined ? undefined : `/cases?case=${remedy.caseId}`;
  return (
    <span className="stack gap-1">
      <span className="row wrap gap-2">
        <span className="text-callout text-medium">
          {t('admin.sessions.remedy.title', { kind: t(REMEDY_KIND[remedy.kind]) })}
        </span>
        <Badge label={t(REMEDY_STATUS[remedy.status])} tone="neutral" />
      </span>
      <span className="text-caption tone-muted">
        {t('admin.sessions.remedy.offeredAt', { when: when(remedy.offeredAt) })}
      </span>
      <span className="text-caption tone-muted">
        {t('admin.sessions.remedy.choiceClosesAt', { when: when(remedy.choiceClosesAt) })}
      </span>
      {remedy.proposal === undefined ? null : (
        <span className="text-caption">
          {t('admin.sessions.remedy.proposal', { time: ownTime(remedy.proposal, t, locale) })}
        </span>
      )}
      {remedy.counter === undefined ? null : (
        <>
          <span className="text-caption">
            {t('admin.sessions.remedy.counter', {
              time: ownTime(remedy.counter, t, locale),
              when: when(remedy.counter.proposedAt),
            })}
          </span>
          <span className="text-caption">
            {t('admin.sessions.remedy.answerClosesAt', {
              when: when(remedy.counter.answerClosesAt),
            })}
          </span>
        </>
      )}
      {remedy.bookingRetriedUntil === undefined ? null : (
        <span className="text-caption tone-warning">
          {t('admin.sessions.remedy.bookingRetried', { when: when(remedy.bookingRetriedUntil) })}
        </span>
      )}
      {remedy.decidedAt === undefined ? null : (
        <span className="text-caption tone-muted">
          {t('admin.sessions.remedy.decidedAt', { when: when(remedy.decidedAt) })}
        </span>
      )}
      {caseHref === undefined ? null : (
        <span className="self-start">
          <TextLink
            label={t('admin.sessions.detail.viewCase')}
            href={caseHref}
            onPress={() => void navigate(caseHref)}
          />
        </span>
      )}
      {isOpenRemedy(remedy) ? (
        <span className="self-start">
          <Button
            label={t('admin.sessions.remedy.handToCase')}
            variant="secondary"
            onPress={() => onHandToCase(remedy.remedyId)}
          />
        </span>
      ) : null}
    </span>
  );
}
