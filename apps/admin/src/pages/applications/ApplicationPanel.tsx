// T071 (FR-160 to FR-162, FR-166): the selected application's detail (`AdminApplications`' panel).
// The header: the applicant, their gender, city and date, the minor flag (FR-132) and the status,
// with the account's standing beside it while the account is not active (T112).
// Each document opens in the viewer, view only (B14b-2). An open identity request is shown with its
// reason, and the document it brought opens in the person's context, with its two decisions;
// «طلب إثبات هوية» is offered on an active account with none open (FR-166). An approved teacher's
// standing is changed here (T073, `StandingDialogs.tsx`). The call is recorded by its day (typed day
// / month / year as the board draws it, T111; its latest day today in the panel's zone), its outcome
// and its notes, while the application is open. The footer offers the actions the status admits;
// «اعتماد» waits for the three conditions, each one said.
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Avatar,
  Badge,
  Banner,
  Button,
  DocThumb,
  Field,
  Input,
  KeyValue,
  Panel,
  Segmented,
  Skeleton,
  TextLink,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { calendarDateOfDayField, dayFieldOf, dayFieldText } from '../../lib/day-field';
import { cityName, dayMonthYear } from '../../lib/format';
import { panelTimeZone, todayIn } from '../../lib/zone';
import { AdminDocumentViewer, type DocumentViewerProps } from '../documents/AdminDocumentViewer';
import { AdminRequireIdDialog } from '../documents/AdminRequireIdDialog';
import { initialsOf } from './initials';
import { ApproveDialog } from './ApproveDialog';
import { DecisionDialog, type DecisionKind } from './DecisionDialog';
import { allowedFor, BLOCKED_TEXT, blockedReasons, STATUS_TEXT } from './decisions';
import { type ApplicationDetail, useApplication, useApplicationActions } from './queries';
import { ReinstateDialog, StandingDialog } from './StandingDialogs';

const CREDENTIAL_TEXT: Readonly<
  Record<ApplicationDetail['credentials'][number]['status'], MessageKey>
> = {
  pending: 'admin.status.credential.inReview',
  needs_document: 'admin.status.credential.anotherFileNeeded',
  approved: 'admin.status.credential.verified',
  rejected: 'admin.status.credential.rejected',
};

const CREDENTIAL_TONE = {
  pending: 'warning',
  needs_document: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const;

/** The account's standing, as the boards chip it (`AdminUsers`, `AdminDocumentViewer`). */
const ACCOUNT_TEXT: Readonly<
  Record<Exclude<ApplicationDetail['accountStatus'], 'active'>, MessageKey>
> = {
  suspended: 'admin.status.account.suspended',
  verification_required: 'admin.status.account.verificationPending',
  banned: 'admin.status.account.banned',
};

const ACCOUNT_TONE = {
  suspended: 'danger',
  verification_required: 'warning',
  banned: 'danger',
} as const;

export function ApplicationPanel({ teacherUserId }: { readonly teacherUserId: string }) {
  const t = useT();
  const detail = useApplication(teacherUserId);
  const answer = detail.data;
  if (answer === undefined) {
    return detail.isError ? (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t('admin.common.loadError.text')}
      </Banner>
    ) : (
      <Skeleton shape="block" />
    );
  }
  // A new key for each application, so its call form starts from its own record.
  return <Detail key={answer.teacherUserId} detail={answer} />;
}

function Detail({ detail }: { readonly detail: ApplicationDetail }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const zone = panelTimeZone();
  const [deciding, setDeciding] = useState<DecisionKind | null>(null);
  const [approving, setApproving] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [requiring, setRequiring] = useState(false);
  const [standing, setStanding] = useState<'change' | 'reinstate' | null>(null);
  // An approved teacher's standing (T073): suspended, reinstated; otherwise suspended, revoked or
  // banned. A banned account has nothing left to change.
  const approved = detail.status === 'approved';
  const reinstatable = approved && detail.accountStatus === 'suspended';
  const changeable =
    approved &&
    (detail.accountStatus === 'active' || detail.accountStatus === 'verification_required');
  // The account's standing beside the application's chip while it is not active (T112); a ban
  // the application's own chip already says is not said twice.
  const shownStanding =
    detail.accountStatus === 'active' ||
    (detail.accountStatus === 'banned' && detail.status === 'banned')
      ? null
      : detail.accountStatus;
  const allowed = allowedFor(detail.status);
  const blocked = blockedReasons(detail);
  const subjectName = (subject: { nameAr: string; nameEn: string }) =>
    locale === 'ar' ? subject.nameAr : subject.nameEn;
  const typeName = (type: 'national_id' | 'passport') =>
    t(
      type === 'passport'
        ? 'admin.common.documentType.passport'
        : 'admin.common.documentType.nationalId',
    );
  const request = detail.identityRequest;
  const requested = request?.document;

  /** The viewer's props for what is being viewed; null once the detail no longer has it (B14b-2
   *  review, round 1: a read after a decision may drop or reorder it). */
  const viewerOf = (what: Viewing): DocumentViewerProps | null => {
    const onClose = () => setViewing(null);
    if (what.kind === 'request') {
      if (request === undefined || requested === undefined) return null;
      return {
        context: 'user',
        documentId: requested.documentId,
        title: typeName(requested.type),
        subtitle: t('admin.dialogs.documentViewer.subtitle', {
          name: detail.displayName,
          date: dayMonthYear(requested.submittedAt, locale, zone),
        }),
        facts: [
          {
            label: t('admin.dialogs.documentViewer.documentType'),
            value: typeName(requested.type),
          },
          {
            label: t('admin.dialogs.documentViewer.requested'),
            value: dayMonthYear(request.requestedAt, locale, zone),
          },
          {
            label: t('admin.dialogs.documentViewer.uploaded'),
            value: dayMonthYear(requested.submittedAt, locale, zone),
          },
        ],
        request: {
          requestId: request.requestId,
          reason: request.reason,
          name: detail.displayName,
        },
        onClose,
      };
    }
    const subtitle = t('admin.dialogs.documentViewer.subtitleApplication', {
      name: detail.displayName,
    });
    if (what.kind === 'credential') {
      const credential = detail.credentials.find(
        ({ credentialId }) => credentialId === what.credentialId,
      );
      if (credential === undefined) return null;
      return {
        context: 'application',
        documentId: credential.documentId,
        title: t('admin.applications.detail.credentialFile', {
          subject: subjectName(credential.subject),
        }),
        subtitle,
        facts: [],
        onClose,
      };
    }
    const identity = detail.identityDocument;
    return {
      context: 'application',
      documentId: identity.documentId,
      title: typeName(identity.type),
      subtitle,
      facts: [
        { label: t('admin.dialogs.documentViewer.documentType'), value: typeName(identity.type) },
        {
          label: t('admin.dialogs.documentViewer.uploaded'),
          value: dayMonthYear(identity.uploadedAt, locale, zone),
        },
      ],
      onClose,
    };
  };
  const viewed = viewing === null ? null : viewerOf(viewing);
  // What is viewed is forgotten once the detail no longer has it, so a later read that brings it
  // back does not open the viewer again on its own (B14b-2 review, round 2).
  if (viewing !== null && viewed === null) setViewing(null);
  // The credential «مراجعة الإجازة» opens: the first still waiting, else the first (T072).
  const toReview =
    detail.credentials.find(({ status }) => status === 'pending') ?? detail.credentials[0];

  return (
    <>
      <Panel
        header={
          <>
            <Avatar initials={initialsOf(detail.displayName)} size="lg" />
            <span className="stack grow">
              <strong className="text-title-3">
                <bdi>{detail.displayName}</bdi>
              </strong>
              <span className="text-caption tone-muted">
                {t('admin.applications.detail.meta', {
                  gender: t(`admin.common.gender.${detail.gender}`),
                  city: cityName(detail.timezoneCity, locale),
                  date: dayMonthYear(detail.submittedAt, locale, zone),
                })}
              </span>
            </span>
            {detail.isMinor ? <Badge label={t('admin.common.minor')} tone="warning" /> : null}
            <Badge label={t(STATUS_TEXT[detail.status])} tone="neutral" />
            {shownStanding === null ? null : (
              <Badge label={t(ACCOUNT_TEXT[shownStanding])} tone={ACCOUNT_TONE[shownStanding]} />
            )}
          </>
        }
        actions={
          <>
            {allowed.approve ? (
              <Button
                label={t('admin.applications.detail.approve')}
                disabled={blocked.length > 0}
                onPress={() => setApproving(true)}
              />
            ) : null}
            {allowed.requestInfo ? (
              <Button
                label={t('admin.applications.detail.requestInfo')}
                variant="secondary"
                onPress={() => setDeciding('requestInfo')}
              />
            ) : null}
            {allowed.reject ? (
              <Button
                label={t('admin.applications.detail.reject')}
                variant="danger"
                onPress={() => setDeciding('reject')}
              />
            ) : null}
            {allowed.ban ? (
              <Button
                label={t('admin.applications.detail.ban')}
                variant="danger"
                icon={{ name: 'ban' }}
                onPress={() => setDeciding('ban')}
              />
            ) : null}
            {changeable ? (
              <Button
                label={t('admin.dialogs.suspendTeacher.kinds.suspend')}
                variant="danger"
                icon={{ name: 'ban' }}
                onPress={() => setStanding('change')}
              />
            ) : null}
            {reinstatable ? (
              <Button
                label={t('admin.dialogs.confirm.reactivateAccount.confirm')}
                icon={{ name: 'rotate-ccw' }}
                onPress={() => setStanding('reinstate')}
              />
            ) : null}
          </>
        }
        {...(allowed.approve ? { note: t('admin.applications.detail.footer') } : {})}
      >
        <div className="row row--top gap-6">
          <section className="section">
            <h2 className="group-label">{t('admin.applications.detail.identity')}</h2>
            <DocThumb
              icon="user"
              label={typeName(detail.identityDocument.type)}
              onPress={() => setViewing({ kind: 'identity' })}
            />
            {detail.accountStatus === 'active' && request === undefined ? (
              <div className="self-start">
                <TextLink
                  label={t('admin.common.action.requireId')}
                  onPress={() => setRequiring(true)}
                />
              </div>
            ) : null}
          </section>
          <section className="section">
            <h2 className="group-label">{t('admin.applications.detail.credentials')}</h2>
            <div className="row row--top gap-3">
              {detail.credentials.map((credential) => (
                <DocThumb
                  key={credential.credentialId}
                  label={t('admin.applications.detail.credentialFile', {
                    subject: subjectName(credential.subject),
                  })}
                  badge={{
                    label: t(CREDENTIAL_TEXT[credential.status]),
                    tone: CREDENTIAL_TONE[credential.status],
                  }}
                  onPress={() =>
                    setViewing({ kind: 'credential', credentialId: credential.credentialId })
                  }
                />
              ))}
            </div>
            <div className="self-start">
              <TextLink
                label={t('admin.applications.detail.reviewCredential')}
                icon={{ name: 'chevron-right' }}
                onPress={() =>
                  void navigate(
                    toReview === undefined
                      ? '/credentials'
                      : `/credentials?credential=${toReview.credentialId}`,
                  )
                }
              />
            </div>
          </section>
        </div>

        {request === undefined ? null : (
          <section className="section">
            <h2 className="group-label">{t('admin.applications.detail.identityRequest.title')}</h2>
            <span className="row wrap gap-2">
              <Badge label={t('admin.status.account.verificationPending')} tone="warning" />
              <span className="text-caption tone-muted">
                {t('admin.applications.detail.identityRequest.requested', {
                  date: dayMonthYear(request.requestedAt, locale, zone),
                })}
              </span>
            </span>
            <p className="text-callout">
              <bdi>{request.reason}</bdi>
            </p>
            {requested === undefined ? (
              <p className="text-callout tone-muted">
                {t('admin.applications.detail.identityRequest.waiting')}
              </p>
            ) : (
              <DocThumb
                icon="user"
                label={typeName(requested.type)}
                onPress={() => setViewing({ kind: 'request' })}
              />
            )}
          </section>
        )}

        <CallRecord detail={detail} editable={allowed.recordCall} />

        <section className="section">
          <h2 className="group-label">{t('admin.applications.detail.subjects')}</h2>
          <div className="row wrap gap-2">
            {detail.subjects.map((subject) => (
              <Badge key={subject.id} label={subjectName(subject)} tone="neutral" />
            ))}
          </div>
          <p className="text-callout">{detail.qualificationSummary}</p>
        </section>

        {allowed.approve && blocked.length > 0 ? (
          <Banner icon={{ name: 'info' }} tone="info">
            <span className="stack gap-1">
              {blocked.map((reason) => (
                <span key={reason}>{t(BLOCKED_TEXT[reason])}</span>
              ))}
            </span>
          </Banner>
        ) : null}
      </Panel>
      {deciding === null ? null : (
        <DecisionDialog
          detail={detail}
          initial={deciding}
          allowed={allowed}
          onClose={() => setDeciding(null)}
        />
      )}
      {approving ? <ApproveDialog detail={detail} onClose={() => setApproving(false)} /> : null}
      {viewed === null ? null : <AdminDocumentViewer {...viewed} />}
      {standing === 'change' ? (
        <StandingDialog detail={detail} onClose={() => setStanding(null)} />
      ) : standing === 'reinstate' ? (
        <ReinstateDialog detail={detail} onClose={() => setStanding(null)} />
      ) : null}
      {requiring ? (
        <AdminRequireIdDialog
          userId={detail.teacherUserId}
          name={detail.displayName}
          role={t(
            detail.gender === 'female'
              ? 'admin.common.role.teacherFemale'
              : 'admin.common.role.teacher',
          )}
          status={t('admin.status.account.activeLong')}
          onClose={() => setRequiring(false)}
        />
      ) : null}
    </>
  );
}

/** What the viewer shows: the application's identity document, a credential's file, or the
 *  document an identity request brought. */
type Viewing =
  | { readonly kind: 'identity' }
  | { readonly kind: 'credential'; readonly credentialId: string }
  | { readonly kind: 'request' };

/** The verification call (FR-161): a form while the application is open, its record otherwise. */
function CallRecord({
  detail,
  editable,
}: {
  readonly detail: ApplicationDetail;
  readonly editable: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const actions = useApplicationActions();
  const [typed, setTyped] = useState(
    detail.call.completedOn === undefined ? '' : dayFieldOf(detail.call.completedOn),
  );
  const [outcome, setOutcome] = useState<string>(detail.call.outcome ?? '');
  const [notes, setNotes] = useState(detail.call.notes ?? '');
  const [state, setState] = useState<'idle' | 'saved' | 'future' | 'failed'>('idle');

  if (!editable) {
    return (
      <section className="section">
        <h2 className="group-label">{t('admin.applications.detail.call')}</h2>
        {detail.call.completedOn === undefined ? (
          <p className="text-callout tone-muted">{t('admin.status.call.notRecorded')}</p>
        ) : (
          <KeyValue
            items={[
              {
                label: t('admin.applications.detail.callDate'),
                value: dayMonthYear(detail.call.completedOn, locale, zone),
              },
              {
                label: t('admin.applications.detail.outcome'),
                value: t(
                  detail.call.outcome === 'unsuitable'
                    ? 'admin.applications.detail.unsuitable'
                    : 'admin.applications.detail.suitable',
                ),
              },
            ]}
          />
        )}
        {detail.call.notes === undefined ? null : (
          <p className="text-callout">{detail.call.notes}</p>
        )}
      </section>
    );
  }

  const day = calendarDateOfDayField(typed);
  const unknownDay = day === undefined && typed.length === 'DD/MM/YYYY'.length;
  const future = day !== undefined && day > todayIn(zone);
  const ready = day !== undefined && !future && outcome !== '' && notes.trim() !== '';
  const save = () => {
    if (day === undefined) return;
    setState('idle');
    actions.recordCall.mutate(
      {
        teacherUserId: detail.teacherUserId,
        completedOn: day,
        timeZone: zone,
        outcome: outcome === 'unsuitable' ? 'unsuitable' : 'suitable',
        notes: notes.trim(),
      },
      {
        onSuccess: () => setState('saved'),
        onError: (error) =>
          setState(
            errorCodeOf(error) === 'VALIDATION_FAILED' &&
              errorDetailsOf(error).some(
                ({ path, code }) => path === 'completedOn' && code === 'future',
              )
              ? 'future'
              : 'failed',
          ),
      },
    );
  };

  return (
    <section className="section">
      <h2 className="group-label">{t('admin.applications.detail.call')}</h2>
      <div className="grid-2 gap-3">
        <Field
          label={t('admin.applications.detail.callDate')}
          {...(unknownDay
            ? { error: t('admin.applications.detail.callDateInvalid') }
            : future || state === 'future'
              ? { error: t('admin.applications.detail.callFuture') }
              : {})}
        >
          <Input
            value={typed}
            onChangeText={(value) => {
              setTyped(dayFieldText(value));
              setState('idle');
            }}
            keyboard="numeric"
            placeholder={t('admin.applications.detail.callDatePlaceholder')}
          />
        </Field>
        <div className="field">
          <span className="field__label">{t('admin.applications.detail.outcome')}</span>
          <Segmented
            accessibilityLabel={t('admin.applications.detail.outcome')}
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: 'suitable', label: t('admin.applications.detail.suitable') },
              { value: 'unsuitable', label: t('admin.applications.detail.unsuitable') },
            ]}
          />
        </div>
      </div>
      <Field label={t('admin.applications.detail.callNotes')}>
        <Input
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder={t('admin.applications.detail.callNotesPlaceholder')}
        />
      </Field>
      {state === 'saved' ? (
        <Banner icon={{ name: 'circle-check' }} tone="success">
          {t('admin.applications.detail.callSaved')}
        </Banner>
      ) : state === 'failed' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('admin.dialogs.submitError')}
        </Banner>
      ) : null}
      <div className="self-start">
        <Button
          label={t('admin.applications.detail.saveCall')}
          variant="secondary"
          disabled={!ready}
          loading={actions.recordCall.isPending}
          onPress={save}
        />
      </div>
    </section>
  );
}
