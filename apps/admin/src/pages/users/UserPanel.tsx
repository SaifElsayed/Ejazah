// B42, T058 (FR-481, FR-459, FR-486, FR-451, FR-426; SRS FR-ADMIN-4; contracts/admin-surface.md
// "`users`"): a user's record beside the directory, as `users.get` answers it, and exactly its fields:
// - the profile: the name or its stand-in, the email, the sign-up instant in the panel's zone, whether
//   the account is deleted, and a teacher's bio and qualification;
// - the role, the declared gender, the minor flag (derived by the server), the teacher profile's
//   verification status (none shown for an account with no teacher profile), the account status;
// - the cancellation requests the user made, all and recent (FR-459);
// - a teacher's marked enrollments (FR-451), each with its student, status and Teacher-No-Show count,
//   linking to `/sessions?enrollment=`.
// On a student's record, the suspend, ban and reinstate buttons open T051's dialogs; which show is the
// account status the server answered, never a rule of the panel's, and the server's refusal is the
// enforcement: suspend and ban while the account is neither suspended nor banned, reinstate while it
// is suspended. After one is done the record and the list are read again.
// B42b, T075 of specs/004-sessions (FR-502; SRS FR-ADMIN-5 as amended, DEC-66, DEC-69): «رفع الحظر»
// on a banned student's or teacher's record and «إلغاء سحب الاعتماد» on a revoked teacher's, at any
// time, opening `UserLiftDialog` with the record's `enrollmentsSlotHeldUntil` and
// `banRestoreWindowDays`; the student's ban says the days too (Q-O2 (a)). A deleted account offers
// none, as the server answers it `NOT_FOUND`. None of the board's date of birth, sign-in method,
// time zone, enrollments' summary, identity requests, «require an identity proof», «bar from
// ijazahs» or a teacher's standing actions (the note under T058, Q2).
// 003:T105 (DEC-89): a teacher's record links to his «تحويلات المعلمين» (`/payouts?teacher=`).
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Badge, Banner, Button, KeyValue, Panel, Skeleton, TextLink } from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { NoShowMark, PartyName } from '../_shared';
import { ENROLLMENT_STATUS } from '../sessions/words';
import { type UserRecord, useRereadUsers, useUserRecord } from './queries';
import { UserLiftDialog, type UserLiftKind } from './LiftDialogs';
import { StudentStandingDialog, type StudentStandingKind } from './StudentStandingDialogs';
import { userLabel } from './UserName';
import { ACCOUNT_STATUS, roleLabel, VERIFICATION_STATUS } from './words';

export function UserPanel({ targetUserId }: { readonly targetUserId: string }) {
  const t = useT();
  const read = useUserRecord(targetUserId);
  if (read.data !== undefined) return <UserRecordPanel record={read.data} />;
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

const STANDING_LABEL = {
  suspend: 'admin.users.detail.suspend',
  ban: 'admin.users.detail.ban',
  reinstate: 'admin.users.reactivate',
} as const;

/** The standing actions a student's account status offers; a teacher's record offers none here, and
 *  neither does a deleted account, which the server answers `NOT_FOUND` (PR #137 r1, Minor 1). */
function standingActions(record: UserRecord): readonly StudentStandingKind[] {
  if (record.role !== 'student' || record.profile.deleted) return [];
  switch (record.accountStatus) {
    case 'suspended':
      return ['reinstate'];
    case 'banned':
      return [];
    default:
      return ['suspend', 'ban'];
  }
}

const LIFT_LABEL: Readonly<
  Record<UserLiftKind, 'admin.users.detail.liftBan' | 'admin.users.detail.liftRevocation'>
> = {
  studentBan: 'admin.users.detail.liftBan',
  teacherBan: 'admin.users.detail.liftBan',
  revocation: 'admin.users.detail.liftRevocation',
};

/** T075: the lift a record's statuses offer: a banned student's or teacher's ban, a revoked teacher's
 *  revocation (a banned one's ban is lifted first, then its revocation); none on a deleted account. */
function liftActions(record: UserRecord): readonly UserLiftKind[] {
  if (record.profile.deleted) return [];
  if (record.accountStatus === 'banned') {
    if (record.role === 'student') return ['studentBan'];
    return record.role === 'teacher' ? ['teacherBan'] : [];
  }
  return record.role === 'teacher' && record.verificationStatus === 'revoked' ? ['revocation'] : [];
}

/** The dialog open on the record, if any. */
type Opened =
  | { readonly action: 'standing'; readonly kind: StudentStandingKind }
  | { readonly action: 'lift'; readonly kind: UserLiftKind };

function UserRecordPanel({ record }: { readonly record: UserRecord }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const reread = useRereadUsers();
  const [opened, setOpened] = useState<Opened | null>(null);
  const { profile } = record;
  const name = userLabel({ userId: record.userId, ...profile }, record.role, t);
  const status = ACCOUNT_STATUS[record.accountStatus];
  const yesNo = (value: boolean) => t(value ? 'admin.common.yes' : 'admin.common.no');
  const actions = standingActions(record);
  const lifts = liftActions(record);
  const payoutsHref = `/payouts?teacher=${record.userId}`;

  return (
    <>
      <Panel
        header={
          <span className="stack grow gap-1">
            <strong className="text-title-3">
              {profile.deleted || profile.displayName === null ? (
                <span className="tone-muted">{name}</span>
              ) : (
                <UserText>{name}</UserText>
              )}
            </strong>
            <span className="row wrap gap-2">
              <span className="text-caption tone-muted">
                {t('admin.users.roleWithStatus', {
                  role: t(roleLabel(record.role)),
                  status: t(status.label),
                })}
              </span>
              {/* 003:T105 (DEC-89): a teacher's record links to his «تحويلات المعلمين». */}
              {record.role === 'teacher' ? (
                <TextLink
                  label={t('admin.money.payouts.userLink')}
                  href={payoutsHref}
                  onPress={() => void navigate(payoutsHref)}
                />
              ) : null}
            </span>
          </span>
        }
        {...(actions.length === 0 && lifts.length === 0
          ? {}
          : {
              actions: (
                <span className="row wrap gap-2">
                  {actions.map((kind) => (
                    <Button
                      key={kind}
                      label={t(STANDING_LABEL[kind])}
                      variant={kind === 'reinstate' ? 'primary' : 'secondary'}
                      onPress={() => setOpened({ action: 'standing', kind })}
                    />
                  ))}
                  {lifts.map((kind) => (
                    <Button
                      key={kind}
                      label={t(LIFT_LABEL[kind])}
                      variant="primary"
                      onPress={() => setOpened({ action: 'lift', kind })}
                    />
                  ))}
                </span>
              ),
            })}
      >
        <section className="section">
          <h2 className="group-label">{t('admin.users.detail.profile')}</h2>
          <KeyValue
            items={[
              {
                label: t('admin.users.record.email'),
                value:
                  profile.email === null ? t('admin.common.none') : <bdi>{profile.email}</bdi>,
              },
              {
                label: t('admin.users.detail.joined'),
                value: dayMonthYear(profile.joinedAt, locale, panelTimeZone()),
              },
              { label: t('admin.users.record.deleted'), value: yesNo(profile.deleted) },
              ...(profile.teacher === undefined
                ? []
                : [
                    {
                      label: t('admin.users.record.bio'),
                      value: <UserText>{profile.teacher.bio}</UserText>,
                    },
                    {
                      label: t('admin.users.record.qualification'),
                      value: <UserText>{profile.teacher.qualification}</UserText>,
                    },
                  ]),
            ]}
          />
        </section>
        <section className="section">
          <h2 className="group-label">{t('admin.users.detail.account')}</h2>
          <KeyValue
            items={[
              { label: t('admin.users.columns.role'), value: t(roleLabel(record.role)) },
              {
                label: t('admin.users.detail.gender'),
                value: t(`admin.common.gender.${record.gender}`),
              },
              {
                label: t('admin.users.detail.minor'),
                // Erasure nulled a deleted account's date of birth, so its flag says nothing (PR #137
                // r1, Minor 2): the dash, as `pages/sessions/words.ts:196` reads another page's key.
                value: profile.deleted ? t('admin.payments.dash') : yesNo(record.isMinor),
              },
              ...(record.verificationStatus === null
                ? []
                : [
                    {
                      label: t('admin.users.record.verification'),
                      value: t(VERIFICATION_STATUS[record.verificationStatus]),
                    },
                  ]),
              {
                label: t('admin.users.columns.status'),
                value: <Badge label={t(status.label)} tone={status.tone} />,
              },
            ]}
          />
        </section>
        <section className="section">
          <h2 className="group-label">{t('admin.users.detail.cancelRequests')}</h2>
          <KeyValue
            items={[
              {
                label: t('admin.users.record.cancellationsTotal'),
                value: String(record.cancellationRequests.total),
              },
              {
                label: t('admin.users.record.cancellationsRecent'),
                value: String(record.cancellationRequests.recent),
              },
            ]}
          />
        </section>
        {record.repeatedAbsences === undefined ? null : (
          <section className="section" aria-label={t('admin.users.record.repeatedAbsences')}>
            <h2 className="group-label">{t('admin.users.record.repeatedAbsences')}</h2>
            {record.repeatedAbsences.length === 0 ? (
              <p className="text-callout tone-muted">
                {t('admin.users.record.noRepeatedAbsences')}
              </p>
            ) : (
              <ul className="stack gap-2">
                {record.repeatedAbsences.map((marked) => {
                  const href = `/sessions?enrollment=${marked.enrollmentId}`;
                  const enrollment = ENROLLMENT_STATUS[marked.status];
                  return (
                    <li key={marked.enrollmentId} className="row wrap gap-2 text-callout">
                      <PartyName party={marked.student} role="student" />
                      <Badge label={t(enrollment.label)} tone={enrollment.tone} />
                      <NoShowMark teacherNoShows={marked.teacherNoShows} repeatedAbsence />
                      <TextLink
                        label={t('admin.users.record.openEnrollment')}
                        href={href}
                        onPress={() => void navigate(href)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </Panel>
      {opened?.action === 'lift' ? (
        <UserLiftDialog
          kind={opened.kind}
          person={{ userId: record.userId, displayName: name }}
          heldUntil={record.enrollmentsSlotHeldUntil}
          days={record.banRestoreWindowDays}
          onLifted={() => void reread()}
          onClose={() => setOpened(null)}
        />
      ) : null}
      {opened?.action !== 'standing' ? null : (
        <StudentStandingDialog
          kind={opened.kind}
          student={{ studentUserId: record.userId, displayName: name }}
          banRestoreWindowDays={record.banRestoreWindowDays}
          onClose={() => setOpened(null)}
          onDone={() => {
            setOpened(null);
            void reread();
          }}
        />
      )}
    </>
  );
}
