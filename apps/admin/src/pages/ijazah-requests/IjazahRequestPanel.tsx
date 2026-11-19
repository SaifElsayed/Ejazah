// 005:T022 (B49; FR-604, FR-610, FR-628; the note under T022, Q-P1 (a)): one ijazah request beside
// the queue, as `ijazahRequests.get` answers it. The certificate is drawn from the request's frozen
// fields (the chain, the grantor's printed name, the student's certificate name, the subject with
// its riwaya and tariq, the completion date, the language) and the signature through
// `signatureLink`; nothing is rendered before approval (the PDF is the ijazah's, after it). The
// teacher's standing now, with its reason (FR-628). While the request is in review: approve (one
// ijazah, keyed) and reject with a reason the teacher sees. Once issued, the way to its ijazah; once
// rejected, the reason. The bar and its lift on the request's student (FR-610).
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
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { ActionDialog } from '../ijazahs/ActionDialog';
import { StudentBar, useStudentName } from '../ijazahs/StudentBar';
import { type RequestDetail, useDecisions, useRequest } from './queries';
import { decisionFailure, REQUEST_STATUS, STANDING } from './words';

export function IjazahRequestPanel({ requestId }: { readonly requestId: string }) {
  const t = useT();
  const read = useRequest(requestId);
  if (read.data !== undefined) return <RequestRecord request={read.data} />;
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

function RequestRecord({ request }: { readonly request: RequestDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const nameOf = useStudentName();
  const decisions = useDecisions();
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const status = REQUEST_STATUS[request.status];
  const standing = STANDING[request.teacherStanding.status];
  const subject = locale === 'ar' ? request.subject.nameAr : request.subject.nameEn;
  const teacher = nameOf(request.teacher);
  const student = nameOf(request.student);
  const generations = t('admin.common.generations', { count: request.chain.length });
  const subjectLine =
    request.tariq === null
      ? t('admin.ijazahRequests.detail.subjectValueNoTariq', { subject, riwaya: request.riwaya })
      : t('admin.ijazahRequests.detail.subjectValue', {
          subject,
          riwaya: request.riwaya,
          tariq: request.tariq,
        });
  const ijazahHref = request.ijazahId === undefined ? null : `/ijazahs?ijazah=${request.ijazahId}`;
  const dialogSubtitle = t('admin.dialogs.confirm.rejectIjazahRequest.subtitle', {
    student,
    subject,
    riwaya: request.riwaya,
    teacher,
  });
  const close = () => setDeciding(null);

  return (
    <>
      <Panel
        header={
          <span className="row wrap gap-2 grow">
            <strong className="text-title-3">
              {t('admin.ijazahRequests.detail.title', { student })}
            </strong>
            <Badge label={t(status.label)} tone={status.tone} />
          </span>
        }
      >
        <section className="section">
          <KeyValue
            columns={2}
            items={[
              { label: t('admin.ijazahRequests.detail.teacher'), value: <bdi>{teacher}</bdi> },
              { label: t('admin.ijazahRequests.detail.student'), value: <bdi>{student}</bdi> },
              {
                label: t('admin.ijazahRequests.detail.completionDate'),
                value: dayMonthYear(request.completionDate, locale, zone),
              },
              {
                label: t('admin.ijazahRequests.detail.language'),
                value: t(`admin.common.language.${request.language}`),
              },
              {
                label: t('admin.ijazahRequests.detail.standing'),
                value: (
                  <span className="stack gap-1">
                    <Badge label={t(standing.label)} tone={standing.tone} />
                    {request.teacherStanding.reason === undefined ? null : (
                      <span className="text-caption tone-muted">
                        {t('admin.ijazahRequests.detail.standingReason', {
                          reason: request.teacherStanding.reason,
                        })}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                label: t('admin.ijazahRequests.columns.submitted'),
                value: dayMonthYear(request.sentAt, locale, zone),
              },
            ]}
          />
          {request.status === 'rejected' && request.reason !== undefined ? (
            <Banner icon={{ name: 'circle-x' }} tone="danger">
              {t('admin.ijazahRequests.detail.rejectionReason', { reason: request.reason })}
            </Banner>
          ) : null}
          {ijazahHref === null ? null : (
            <span className="row wrap gap-2 text-callout">
              {request.decidedAt === undefined ? null : (
                <span>
                  {t('admin.ijazahRequests.issuedOn', {
                    date: dayMonthYear(request.decidedAt, locale, zone),
                  })}
                </span>
              )}
              <TextLink
                label={t('admin.ijazahRequests.detail.openIjazah')}
                href={ijazahHref}
                onPress={() => void navigate(ijazahHref)}
              />
            </span>
          )}
        </section>
        <section
          className="section certificate-preview"
          aria-label={t('admin.ijazahRequests.detail.a11yCertificate')}
        >
          <h2 className="group-label">{t('admin.ijazahRequests.detail.a11yCertificate')}</h2>
          <KeyValue
            columns={2}
            items={[
              {
                label: t('admin.ijazahRequests.detail.certificateName'),
                value:
                  request.studentName === null ? (
                    <span className="tone-muted">
                      {t('admin.ijazahRequests.detail.noCertificateName')}
                    </span>
                  ) : (
                    <bdi>{request.studentName}</bdi>
                  ),
              },
              {
                label: t('admin.ijazahs.detail.grantor'),
                value: <bdi>{request.teacherNamePrinted}</bdi>,
              },
              { label: t('admin.ijazahRequests.detail.subject'), value: subjectLine },
            ]}
          />
          <h3 className="group-label">{t('admin.ijazahRequests.detail.chainTitle')}</h3>
          <ol className="stack gap-1 text-callout">
            {request.chain.map((names, index) => (
              <li key={`${String(index)}-${names.join('|')}`} className="row wrap gap-2">
                {names.map((name) => (
                  <bdi key={name}>{name}</bdi>
                ))}
              </li>
            ))}
          </ol>
          <p className="text-caption tone-muted">
            {t('admin.ijazahRequests.detail.chainNote', { generations })}
          </p>
          <h3 className="group-label">{t('admin.ijazahRequests.detail.signature')}</h3>
          {request.signatureLink === null ? (
            <p className="text-callout tone-muted">
              {t('admin.ijazahRequests.detail.signatureErased')}
            </p>
          ) : (
            <img
              className="certificate-page__image"
              src={request.signatureLink}
              alt={t('admin.ijazahRequests.detail.signature')}
            />
          )}
        </section>
        {request.status === 'pending' ? (
          <section className="section">
            <span className="row wrap gap-2">
              <Button
                label={t('admin.ijazahRequests.detail.approve')}
                variant="primary"
                onPress={() => setDeciding('approve')}
              />
              <Button
                label={t('admin.ijazahRequests.detail.reject')}
                variant="danger"
                onPress={() => setDeciding('reject')}
              />
            </span>
          </section>
        ) : null}
        <section className="section">
          <h2 className="group-label">{t('admin.ijazahRequests.detail.barTitle')}</h2>
          <StudentBar student={request.student} />
        </section>
      </Panel>
      {deciding === 'approve' ? (
        <ActionDialog
          title={t('admin.dialogs.confirm.issueIjazah.title')}
          subtitle={t('admin.dialogs.confirm.issueIjazah.subtitle', {
            student,
            subject,
            riwaya: request.riwaya,
            teacher,
          })}
          icon="award"
          tone="primary"
          effects={[
            t('admin.dialogs.confirm.issueIjazah.effects.issued', {
              grantor: request.teacherNamePrinted,
              grantee: request.studentName ?? student,
            }),
            t('admin.dialogs.confirm.issueIjazah.effects.notified', { teacher, student }),
            t('admin.dialogs.confirm.issueIjazah.effects.signOff'),
          ]}
          confirm={t('admin.dialogs.confirm.issueIjazah.confirm')}
          run={(_reason, key) => decisions.approve(request.requestId, key)}
          failureOf={decisionFailure}
          onClose={close}
        />
      ) : null}
      {deciding === 'reject' ? (
        <ActionDialog
          title={t('admin.dialogs.confirm.rejectIjazahRequest.title')}
          subtitle={dialogSubtitle}
          icon="circle-x"
          tone="danger"
          effects={[
            t('admin.dialogs.confirm.rejectIjazahRequest.effects.notIssued'),
            t('admin.dialogs.confirm.rejectIjazahRequest.effects.notified', { teacher }),
            t('admin.dialogs.confirm.rejectIjazahRequest.effects.enrollmentUnchanged'),
          ]}
          reason={{
            label: t('admin.dialogs.confirm.rejectIjazahRequest.reasonLabel'),
            hint: t('admin.dialogs.confirm.rejectIjazahRequest.reasonHint'),
            placeholder: t('admin.dialogs.confirm.rejectIjazahRequest.reasonPlaceholder'),
          }}
          confirm={t('admin.dialogs.confirm.rejectIjazahRequest.confirm')}
          run={(reason, key) => decisions.reject(request.requestId, reason, key)}
          failureOf={decisionFailure}
          onClose={close}
        />
      ) : null}
    </>
  );
}
