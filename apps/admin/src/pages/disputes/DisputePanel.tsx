// T049 (FR-475, FR-476, FR-472, FR-487, FR-426): one dispute beside the queue, as `disputes.get`
// answers it. The page renders what the server answered and the server decides:
// - the header: who raised the dispute and when, and its state;
// - the raiser's reason, the session's two parties (lane S's `PartyName`, a deleted one's
//   stand-in), and the link to the enrollment on `/sessions?enrollment=` (Q4);
// - a closed dispute's ruling, its reason and its revisions beside it (T059), the revision's button
//   only while `revisable`, and after a revision what it left as it was (`notUndone`);
// - the telemetry (`DisputeTelemetry`);
// - the enrollment's chat only while `chatAvailable` (`DisputeChatSection`; Q2: no page of its
//   own, no reason for viewing);
// - the «held files» (lane S's `HeldFilesSection`) only while the dispute is open and a party of
//   its enrollment is deleted (Q5 (b), from `parties`);
// - the ruling's button only while the dispute is open (`ResolveDialog`).
// A hidden button is never the enforcement: the server refuses, and the dialog says why.
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
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { HeldFilesSection, PartyName } from '../_shared';
import { DisputeChatSection } from './DisputeChatSection';
import { DisputeTelemetry } from './DisputeTelemetry';
import { DISPUTE_STATE, RAISED_BY, ROLE, RULING, SESSION_STATUS } from './labels';
import { type DisputeView, type RevisionAnswer, useDispute } from './queries';
import { ResolveDialog } from './ResolveDialog';
import { ReviseDialog } from './ReviseDialog';

export function DisputePanel({ disputeId }: { readonly disputeId: string }) {
  const t = useT();
  const read = useDispute(disputeId);
  if (read.data !== undefined) return <DisputeDetailPanel view={read.data} />;
  if (read.isError) {
    return (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t('admin.common.loadError.text')}
      </Banner>
    );
  }
  return <Skeleton shape="block" />;
}

function DisputeDetailPanel({ view }: { readonly view: DisputeView }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const { dispute, parties } = view;
  const [resolving, setResolving] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revised, setRevised] = useState<RevisionAnswer | undefined>(undefined);
  const state = DISPUTE_STATE[dispute.status];
  const open = dispute.status === 'open';
  const partyDeleted = parties.student.deleted || parties.teacher.deleted;
  const enrollmentHref = `/sessions?enrollment=${dispute.enrollmentId}`;
  const when = (value: string) => ({
    date: dayMonth(value, locale, zone),
    time: timeOfDay(value, locale, zone),
  });

  return (
    <Panel
      header={
        <span className="stack grow">
          <strong className="text-title-3">
            {t(RAISED_BY[dispute.raisedBy], { date: dayMonth(dispute.raisedAt, locale, zone) })}
          </strong>
          <span className="self-start">
            <Badge label={t(state.label)} tone={state.tone} />
          </span>
        </span>
      }
      {...(open
        ? {
            actions: (
              <Button
                label={t('admin.disputes.detail.issue')}
                icon={{ name: 'scale' }}
                onPress={() => setResolving(true)}
              />
            ),
          }
        : {})}
    >
      <section className="section">
        <h2 className="group-label">{t('admin.disputes.view.reasonTitle')}</h2>
        <p className="text-callout">
          <UserText>{dispute.reason}</UserText>
        </p>
        {open ? (
          <KeyValue
            items={[
              {
                label: t('admin.disputes.queue.columns.outcome'),
                value:
                  dispute.outcomeUnderDispute === undefined
                    ? t('admin.disputes.queue.notEvaluated')
                    : t(SESSION_STATUS[dispute.outcomeUnderDispute]),
              },
            ]}
          />
        ) : null}
      </section>
      <section className="section">
        <h2 className="group-label">{t('admin.disputes.view.partiesTitle')}</h2>
        <KeyValue
          items={[
            {
              label: t(ROLE.student),
              value: <PartyName party={parties.student} role="student" />,
            },
            {
              label: t(ROLE.teacher),
              value: <PartyName party={parties.teacher} role="teacher" />,
            },
          ]}
        />
        <span className="self-start">
          <TextLink
            label={t('admin.disputes.view.enrollmentLink')}
            href={enrollmentHref}
            onPress={() => void navigate(enrollmentHref)}
          />
        </span>
      </section>
      {dispute.resolution === undefined && open ? null : (
        <section className="section">
          <h2 className="group-label">{t('admin.disputes.view.rulingTitle')}</h2>
          {dispute.resolution === undefined ? null : (
            <p className="text-callout text-medium">{t(RULING[dispute.resolution])}</p>
          )}
          {dispute.resolvedAt === undefined ? null : (
            <p className="text-caption tone-muted">
              {t('admin.disputes.view.rulingAt', when(dispute.resolvedAt))}
            </p>
          )}
          {dispute.resolutionNotes === undefined ? null : (
            <KeyValue
              items={[
                {
                  label: t('admin.disputes.view.rulingNotes'),
                  value: <UserText>{dispute.resolutionNotes}</UserText>,
                },
              ]}
            />
          )}
          <h3 className="group-label">{t('admin.disputes.view.revisionsTitle')}</h3>
          <p className="text-caption tone-muted">{t('admin.disputes.view.revisionsNote')}</p>
          {view.revisions.length === 0 ? (
            <p className="text-callout">{t('admin.disputes.view.revisionsNone')}</p>
          ) : (
            <ul className="stack gap-2">
              {view.revisions.map((revision) => (
                <li key={revision.revisedAt} className="text-callout">
                  {t('admin.disputes.view.revision', {
                    before: t(SESSION_STATUS[revision.outcomeBefore]),
                    after: t(SESSION_STATUS[revision.outcomeAfter]),
                    ...when(revision.revisedAt),
                  })}
                </li>
              ))}
            </ul>
          )}
          {revised === undefined ? null : <RevisedNotice answer={revised} />}
          {view.revisable ? (
            <span className="self-start">
              <Button
                label={t('admin.disputes.view.reviseButton')}
                variant="secondary"
                icon={{ name: 'rotate-ccw' }}
                onPress={() => setRevising(true)}
              />
            </span>
          ) : null}
        </section>
      )}
      <DisputeTelemetry telemetry={view.telemetry} />
      {view.chatAvailable ? <DisputeChatSection disputeId={dispute.disputeId} /> : null}
      {open && partyDeleted ? <HeldFilesSection disputeId={dispute.disputeId} /> : null}
      {resolving ? <ResolveDialog view={view} onClose={() => setResolving(false)} /> : null}
      {revising ? (
        <ReviseDialog
          disputeId={dispute.disputeId}
          onDone={(answer) => {
            setRevised(answer);
            setRevising(false);
          }}
          onClose={() => setRevising(false)}
        />
      ) : null}
    </Panel>
  );
}

/** What the revision wrote, and what the earlier ruling did that it left as it was (FR-472). */
function RevisedNotice({ answer }: { readonly answer: RevisionAnswer }) {
  const t = useT();
  return (
    <Banner icon={{ name: 'info' }} tone="neutral">
      <span className="stack gap-2">
        <span>
          {t('admin.disputes.revise.done', {
            after: t(SESSION_STATUS[answer.sessionStatus]),
            before: t(SESSION_STATUS[answer.previousStatus]),
          })}
        </span>
        {answer.notUndone.length === 0 ? null : (
          <>
            <strong>{t('admin.disputes.revise.notUndoneTitle')}</strong>
            <ul className="stack gap-1">
              {answer.notUndone.map((kind) => (
                <li key={kind}>{t(`admin.disputes.revise.notUndone.${kind}`)}</li>
              ))}
            </ul>
          </>
        )}
      </span>
    </Banner>
  );
}
