// 005:T023 (B49; FR-615 to FR-617; DEC-69; the note under T023, Q-G1 (b), Q-G5 (b)): one gender
// flag beside the list, as `genderFlags.get` answers it. The header names its status; the flagged
// person and the raiser (links to their records, or the administrator's words), the report it came
// from (`/reports?report=`), its date; the raiser's words; once decided, the decision's reason and
// date. While it is open, the enrollments a correction would end now, and the three decisions, each
// with a mandatory reason:
// - the dismissal: the declared gender stays;
// - the correction (an honest error): its dialog draws each enrollment it ends (`enrollmentLine`: the
//   subject, the sessions, the other party, a link to `/sessions?enrollment=`) and below them that
//   they can never be restored (FR-616, DEC-69). ⚠️ Irreversible;
// - the fraud ban: the gender corrected, then the account banned, with the note an applicant sees
//   (`applicantNote`, Q-G5 (b); the server refuses an applicant's ban without it).
// The «notified» effects of the board are not drawn: v1.0 sends no push for these (Q-G7 (a)).
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
import { DecisionDialog } from './DecisionDialog';
import { PersonLink } from './PersonLink';
import { type GenderFlagDetail, useGenderActions, useGenderFlag } from './queries';
import { GENDER_FLAG_STATUS, genderFlagFailure } from './words';

export function GenderPanel({ flagId }: { readonly flagId: string }) {
  const t = useT();
  const read = useGenderFlag(flagId);
  if (read.data !== undefined) return <FlagRecord flag={read.data} />;
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

type Deciding = 'dismiss' | 'correct' | 'ban';

function FlagRecord({ flag }: { readonly flag: GenderFlagDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const actions = useGenderActions();
  const [deciding, setDeciding] = useState<Deciding | null>(null);
  const status = GENDER_FLAG_STATUS[flag.status];
  const reportHref = flag.reportId === null ? null : `/reports?report=${flag.reportId}`;
  const preview = flag.correctionWouldEnd;
  const close = () => setDeciding(null);

  return (
    <>
      <Panel
        header={
          <span className="row wrap gap-2 grow">
            <Badge label={t(status.label)} tone={status.tone} />
          </span>
        }
      >
        <section className="section">
          <KeyValue
            columns={2}
            items={[
              {
                label: t('admin.gender.detail.flagged'),
                value: <PersonLink userId={flag.flaggedUserId} />,
              },
              {
                label: t('admin.gender.detail.raisedBy'),
                value:
                  flag.raisedByUserId === null ? (
                    t('admin.gender.detail.raisedByAdmin')
                  ) : (
                    <PersonLink userId={flag.raisedByUserId} />
                  ),
              },
              {
                label: t('admin.gender.detail.fromReport'),
                value:
                  reportHref === null ? (
                    t('admin.payments.dash')
                  ) : (
                    <TextLink
                      label={t('admin.gender.detail.openReport')}
                      href={reportHref}
                      onPress={() => void navigate(reportHref)}
                    />
                  ),
              },
              {
                label: t('admin.gender.columns.date'),
                value: dayMonthYear(flag.createdAt, locale, zone),
              },
            ]}
          />
        </section>
        <section className="section">
          <h2 className="group-label">{t('admin.gender.detail.reason')}</h2>
          <p className="text-callout">
            <UserText>{flag.reason}</UserText>
          </p>
        </section>
        {flag.resolution === null ? null : (
          <section className="section">
            <KeyValue
              columns={2}
              items={[
                {
                  label: t('admin.gender.detail.decision'),
                  value: t('admin.gender.detail.decidedOn', {
                    date: dayMonthYear(flag.resolution.resolvedAt, locale, zone),
                  }),
                },
                {
                  label: t('admin.gender.detail.note'),
                  value:
                    flag.resolution.note === null ? (
                      t('admin.payments.dash')
                    ) : (
                      <UserText>{flag.resolution.note}</UserText>
                    ),
                },
              ]}
            />
          </section>
        )}
        {flag.status === 'open' ? (
          <section className="section">
            <h2 className="group-label">
              {t('admin.gender.detail.affectedEnrollments', { count: preview.count })}
            </h2>
            {preview.count === 0 ? (
              <p className="text-callout tone-muted">{t('admin.gender.detail.noEnrollments')}</p>
            ) : null}
            <span className="row wrap gap-2">
              <Button
                label={t('admin.gender.detail.dismiss')}
                variant="secondary"
                onPress={() => setDeciding('dismiss')}
              />
              <Button
                label={t('admin.gender.detail.correct')}
                variant="primary"
                onPress={() => setDeciding('correct')}
              />
              <Button
                label={t('admin.gender.detail.ban')}
                variant="danger"
                onPress={() => setDeciding('ban')}
              />
            </span>
          </section>
        ) : null}
      </Panel>
      {deciding === 'dismiss' ? (
        <DecisionDialog
          title={t('admin.dialogs.confirm.dismissGenderFlag.heading')}
          icon="circle-x"
          tone="primary"
          effects={[t('admin.dialogs.confirm.dismissGenderFlag.effects.unchanged')]}
          reasonLabel={t('admin.dialogs.confirm.dismissGenderFlag.reasonLabel')}
          confirm={t('admin.dialogs.confirm.dismissGenderFlag.confirm')}
          run={(reason, _extra, key) => actions.dismiss(flag.flagId, reason, key)}
          failureOf={genderFlagFailure}
          onClose={close}
        />
      ) : null}
      {deciding === 'correct' ? (
        <DecisionDialog
          title={t('admin.dialogs.confirm.genderCorrect.heading')}
          icon="triangle-alert"
          tone="danger"
          effects={[
            t('admin.dialogs.confirm.genderCorrect.effects.record'),
            t('admin.dialogs.confirm.genderCorrect.effects.enrollments'),
            t('admin.dialogs.confirm.genderCorrect.effects.cases'),
          ]}
          reasonLabel={t('admin.dialogs.confirm.genderCorrect.reasonLabel')}
          confirm={t('admin.dialogs.confirm.genderCorrect.confirm')}
          run={(reason, _extra, key) => actions.correct(flag.flagId, reason, key)}
          failureOf={genderFlagFailure}
          onClose={close}
        >
          <CorrectionLines preview={preview} />
        </DecisionDialog>
      ) : null}
      {deciding === 'ban' ? (
        <DecisionDialog
          title={t('admin.dialogs.confirm.genderBan.heading')}
          icon="ban"
          tone="danger"
          effects={[
            t('admin.dialogs.confirm.genderCorrect.effects.record'),
            t('admin.dialogs.confirm.genderBan.effects.enrollments'),
            t('admin.dialogs.confirm.genderBan.effects.cases'),
            t('admin.dialogs.confirm.genderBan.effects.liftable'),
          ]}
          reasonLabel={t('admin.dialogs.confirm.genderBan.reasonLabel')}
          extra={{
            label: t('admin.gender.detail.applicantNoteLabel'),
            hint: t('admin.gender.detail.applicantNoteHint'),
            required: false,
          }}
          confirm={t('admin.dialogs.confirm.genderBan.confirm')}
          run={(reason, applicantNote, key) =>
            actions.fraudBan(flag.flagId, reason, applicantNote, key)
          }
          failureOf={genderFlagFailure}
          onClose={close}
        />
      ) : null}
    </>
  );
}

/**
 * The enrollments the correction ends (Q-G1 (b)), each a link to its enrollment, then that they
 * can never be restored (FR-616, DEC-69).
 */
function CorrectionLines({
  preview,
}: {
  readonly preview: GenderFlagDetail['correctionWouldEnd'];
}) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  return (
    <section className="section">
      <h3 className="group-label">
        {t('admin.gender.detail.affectedEnrollments', { count: preview.count })}
      </h3>
      {preview.count === 0 ? (
        <p className="text-callout tone-muted">{t('admin.gender.detail.noEnrollments')}</p>
      ) : (
        <ul className="stack gap-1 text-callout">
          {preview.lines.map((line) => {
            const href = `/sessions?enrollment=${line.enrollmentId}`;
            return (
              <li key={line.enrollmentId}>
                <TextLink
                  label={t('admin.gender.detail.enrollmentLine', {
                    subject: locale === 'ar' ? line.subject.nameAr : line.subject.nameEn,
                    sessions: t('admin.common.sessions', { count: line.sessions }),
                    counterpart:
                      line.counterpart.displayName ?? t('admin.users.directory.deletedAccount'),
                  })}
                  href={href}
                  onPress={() => void navigate(href)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Banner icon={{ name: 'triangle-alert' }} tone="danger">
        {t('admin.gender.detail.neverRestored')}
      </Banner>
    </section>
  );
}
