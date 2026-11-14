// T073 (FR-173): an approved teacher's standing, from the application's detail (B14d, the owner's
// decision: the teacher's own page lands in a later phase). `AdminSuspendDialog`'s three kinds,
// suspend, revoke the approval, ban, each with what the server does now and a mandatory reason; the
// board's sessions cancelled, students notified and compensation cases are a later phase's and are
// not said (R-HONEST, the rule T072 set). A suspended teacher is reinstated with a reason
// (`reactivateAccount`). A refusal is said in place; a decision reads the detail and the queue again.
// B42b, T075 of specs/004-sessions (FR-502, FR-504; SRS FR-ADMIN-5 and FR-SESS-16 as amended,
// DEC-66, DEC-69; the note under T075, Q-O2 (a) and Q-R6 (a); FU5): the ban says each enrollment's
// slot is held for `{days}`, `applications.get`'s `banRestoreWindowDays`, and that the ban can be
// lifted at any time; the suspension that the enrollments pause and what the reinstatement offers;
// the reinstatement that the paused enrollments resume, and `STUDENT_SUSPENDED` what unblocks it.
// `LiftBanDialog`, «رفع الحظر» on a banned account (`teachers.liftBan`, an applicant's or a teacher's
// ban), promises nothing about enrollments and draws each result the answer returns, with a link to
// the person's `/users` record.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input, Segmented } from '../../design/components';
import { type MessageKey, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { LiftDialog } from '../users/LiftDialogs';
import type { ApplicationDetail } from './queries';

type Kind = 'suspend' | 'revokeApproval' | 'ban';

const DRAWN: Readonly<
  Record<
    Kind,
    { readonly title: MessageKey; readonly effect: MessageKey; readonly reason: MessageKey }
  >
> = {
  suspend: {
    title: 'admin.dialogs.suspendTeacher.title',
    effect: 'admin.dialogs.suspendTeacher.honest.suspend',
    reason: 'admin.dialogs.suspendTeacher.reasonLabel',
  },
  revokeApproval: {
    title: 'admin.dialogs.suspendTeacher.revoke.title',
    effect: 'admin.dialogs.suspendTeacher.honest.revoke',
    reason: 'admin.dialogs.suspendTeacher.revoke.reasonLabel',
  },
  ban: {
    title: 'admin.dialogs.suspendTeacher.ban.title',
    effect: 'admin.dialogs.suspendTeacher.honest.ban',
    reason: 'admin.dialogs.suspendTeacher.ban.reasonLabel',
  },
};

function useStandingActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const reread = async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: ['applications'] }),
      queries.invalidateQueries({ queryKey: ['home', 'summary'] }),
    ]);
  };
  const api = client.api.teachers;
  type Input = Parameters<typeof api.suspend.mutate>[0];
  return useMutation({
    mutationFn: ({ kind, input }: { readonly kind: Kind | 'reinstate'; readonly input: Input }) =>
      api[kind].mutate(input),
    onSuccess: reread,
  });
}

export function StandingDialog({
  detail,
  onClose,
}: {
  readonly detail: ApplicationDetail;
  readonly onClose: () => void;
}) {
  const t = useT();
  const act = useStandingActions();
  const [kind, setKind] = useState<Kind>('suspend');
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<ErrorMessage | null>(null);
  const drawn = DRAWN[kind];
  const kindLabel = (value: Kind) =>
    t(
      value === 'suspend'
        ? 'admin.dialogs.suspendTeacher.kinds.suspend'
        : value === 'revokeApproval'
          ? 'admin.dialogs.suspendTeacher.kinds.revokeApproval'
          : 'admin.dialogs.suspendTeacher.kinds.ban',
    );
  return (
    <Dialog
      open
      title={t(drawn.title, { name: detail.displayName })}
      leading={<IconTile icon={{ name: 'ban' }} tone="danger" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.suspendTeacher.cancel'),
          variant: 'secondary',
          disabled: act.isPending,
          onPress: onClose,
        },
        {
          label: kindLabel(kind),
          variant: 'danger',
          disabled: reason.trim() === '',
          loading: act.isPending,
          onPress: () => {
            setFailed(null);
            act.mutate(
              { kind, input: { teacherUserId: detail.teacherUserId, reason: reason.trim() } },
              { onSuccess: onClose, onError: (error: unknown) => setFailed(errorMessageKey(error, 'admin.dialogs.submitError')) },
            );
          },
        },
      ]}
    >
      <Segmented
        accessibilityLabel={t('admin.applications.detail.standing')}
        value={kind}
        onChange={(value) => {
          setKind(value as Kind);
          setFailed(null);
        }}
        options={(['suspend', 'revokeApproval', 'ban'] as const).map((value) => ({
          value,
          label: kindLabel(value),
        }))}
      />
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.suspendTeacher.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t(drawn.effect, { days: detail.banRestoreWindowDays })}</span>
        </p>
      </section>
      <Field label={t(drawn.reason)} hint={t('admin.dialogs.suspendTeacher.reasonHint')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.suspendTeacher.reasonPlaceholder')}
        />
      </Field>
      {failed !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failed.key, failed.values)}
        </Banner>
      ) : null}
    </Dialog>
  );
}

export function ReinstateDialog({
  detail,
  onClose,
}: {
  readonly detail: ApplicationDetail;
  readonly onClose: () => void;
}) {
  const t = useT();
  const act = useStandingActions();
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<ErrorMessage | null>(null);
  return (
    <Dialog
      open
      title={t('admin.dialogs.confirm.reactivateAccount.title', { name: detail.displayName })}
      leading={<IconTile icon={{ name: 'rotate-ccw' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: act.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.confirm.reactivateAccount.confirm'),
          disabled: reason.trim() === '',
          loading: act.isPending,
          onPress: () => {
            setFailed(null);
            act.mutate(
              {
                kind: 'reinstate',
                input: { teacherUserId: detail.teacherUserId, reason: reason.trim() },
              },
              {
                onSuccess: onClose,
                onError: (error: unknown) => setFailed(reinstateFailure(error)),
              },
            );
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="user-check" size="sm" />
          <span>
            {t(
              // T113: an open identity request keeps the account `verification_required`.
              detail.identityRequest === undefined
                ? 'admin.dialogs.confirm.reactivateAccount.effects.reinstated'
                : 'admin.dialogs.confirm.reactivateAccount.effects.reinstatedAwaitingIdentity',
            )}
          </span>
        </p>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.dialogs.confirm.reactivateAccount.effects.resumed')}</span>
        </p>
      </section>
      <Field label={t('admin.dialogs.confirm.reactivateAccount.reasonLabel')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failed !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failed.key, failed.values)}
        </Banner>
      ) : null}
    </Dialog>
  );
}

/** T075 (FU5): a reinstatement refused while a paused enrollment's student is suspended. */
function reinstateFailure(error: unknown): ErrorMessage {
  return errorCodeOf(error) === 'STUDENT_SUSPENDED'
    ? { key: 'admin.dialogs.confirm.reactivateAccount.refused.studentSuspended' }
    : errorMessageKey(error, 'admin.dialogs.submitError');
}

/** T075 (Q-R6 (a)): «رفع الحظر» on the application's page, an applicant's ban or a teacher's. */
export function LiftBanDialog({
  detail,
  onClose,
}: {
  readonly detail: ApplicationDetail;
  readonly onClose: () => void;
}) {
  const t = useT();
  const { client } = useAdmin();
  const queries = useQueryClient();
  return (
    <LiftDialog
      title={t('admin.users.lift.banTitle', { name: detail.displayName })}
      effects={[t('admin.applications.lift.effect')]}
      reasonLabel="admin.users.lift.banReasonLabel"
      confirm={t('admin.applications.detail.liftBan')}
      done="admin.users.lift.doneBan"
      send={(reason, idempotencyKey) =>
        client.api.teachers.liftBan.mutate({
          teacherUserId: detail.teacherUserId,
          reason,
          idempotencyKey,
        })
      }
      record={{
        href: `/users?user=${detail.teacherUserId}`,
        label: 'admin.applications.lift.record',
      }}
      onLifted={() => {
        void Promise.all([
          queries.invalidateQueries({ queryKey: ['applications'] }),
          queries.invalidateQueries({ queryKey: ['home', 'summary'] }),
          queries.invalidateQueries({ queryKey: ['users'] }),
        ]);
      }}
      onClose={onClose}
    />
  );
}
