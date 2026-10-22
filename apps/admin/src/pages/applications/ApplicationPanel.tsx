// T071 (FR-160 to FR-162): the selected application's detail (`AdminApplications`' panel). The
// header: the applicant, their gender, city and date, the minor flag (FR-132) and the status. The
// documents are shown and open nothing until the viewer lands (B14b-2, the T052 rule). The call is
// recorded by its day (the browser's date field, its latest day today in the panel's zone), its
// outcome and its notes, while the application is open. The footer offers the actions the status
// admits; «اعتماد» waits for the three conditions, each one said.
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
import { cityName, dayMonthYear } from '../../lib/format';
import { panelTimeZone, todayIn } from '../../lib/zone';
import { initialsOf } from './initials';
import { ApproveDialog } from './ApproveDialog';
import { DecisionDialog, type DecisionKind } from './DecisionDialog';
import { allowedFor, BLOCKED_TEXT, blockedReasons, STATUS_TEXT } from './decisions';
import { type ApplicationDetail, useApplication, useApplicationActions } from './queries';

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
  const allowed = allowedFor(detail.status);
  const blocked = blockedReasons(detail);
  const subjectName = (subject: { nameAr: string; nameEn: string }) =>
    locale === 'ar' ? subject.nameAr : subject.nameEn;

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
          </>
        }
        {...(allowed.approve ? { note: t('admin.applications.detail.footer') } : {})}
      >
        <div className="row row--top gap-6">
          <section className="section">
            <h2 className="group-label">{t('admin.applications.detail.identity')}</h2>
            <DocThumb
              icon="user"
              label={t(
                detail.identityDocument.type === 'passport'
                  ? 'admin.common.documentType.passport'
                  : 'admin.common.documentType.nationalId',
              )}
            />
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
                />
              ))}
            </div>
            <div className="self-start">
              <TextLink
                label={t('admin.applications.detail.reviewCredential')}
                icon={{ name: locale === 'ar' ? 'chevron-left' : 'chevron-right' }}
                onPress={() => void navigate('/credentials')}
              />
            </div>
          </section>
        </div>

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
    </>
  );
}

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
  const [day, setDay] = useState(detail.call.completedOn ?? '');
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

  const ready = day !== '' && outcome !== '' && notes.trim() !== '';
  const save = () => {
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
          hint={t('admin.applications.detail.callDatePlaceholder')}
          {...(state === 'future' ? { error: t('admin.applications.detail.callFuture') } : {})}
        >
          <Input
            value={day}
            onChangeText={(value) => {
              setDay(value);
              setState('idle');
            }}
            keyboard="date"
            max={todayIn(zone)}
            ltr
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
