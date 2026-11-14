// B42b, T075 of specs/004-sessions (FR-502, FR-503; SRS FR-ADMIN-5 as amended, DEC-66, DEC-69; the
// note under T075, Q-O2 (a) and Q-R6 (a); N11; contracts/admin-surface.md, `students.liftBan`,
// `teachers.liftBan`, `teachers.liftRevocation`): a ban or a revocation lifted, at any time.
// - `LiftDialog`: what the lift does, a mandatory reason, the idempotency key minted when the dialog
//   opens and reused on its retry (a lost answer is never a second lift), the refusal said in place
//   (`liftFailure`, `restore_failed` with a link to its enrollment), then each enrollment's result
//   `{ enrollmentId, restored, cause }` in plain words, each linking to `/sessions`. The caller reads
//   again once the server answered (`onLifted`); the dialog closes on «إغلاق».
// - `UserLiftDialog`, `/users`' three: a student's ban (`students.liftBan`), a teacher's
//   (`teachers.liftBan`) and a revocation (`teachers.liftRevocation`), each saying the enrollments
//   come back, their slots held until `{when}` (`users.get`'s `enrollmentsSlotHeldUntil`) for
//   `{days}` (`banRestoreWindowDays`), and afterwards only where still free.
// No word says a ban or a revocation is final. The server decides; a shown button is never the
// enforcement.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Banner, Dialog, Field, Icon, IconTile, Input, TextLink } from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { panelTimeZone } from '../../lib/zone';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { instant } from '../sessions/words';
import { type LiftedEnrollment, type LiftFailure, liftFailure, liftResult } from './words';

export interface LiftDialogProps {
  readonly title: string;
  /** What the lift does, each one line. */
  readonly effects: readonly string[];
  readonly reasonLabel: MessageKey;
  readonly confirm: string;
  /** Said once the server lifted. */
  readonly done: MessageKey;
  /** Sends the lift with the reason and the dialog's key. */
  readonly send: (
    reason: string,
    idempotencyKey: string,
  ) => Promise<{ readonly enrollments: readonly LiftedEnrollment[] }>;
  /** The person's `/users` record, linked once lifted (the applicant's page, Q-R6 (a)). */
  readonly record?: { readonly href: string; readonly label: MessageKey };
  /** The server lifted: the caller reads again. */
  readonly onLifted: () => void;
  readonly onClose: () => void;
}

export function LiftDialog({
  title,
  effects,
  reasonLabel,
  confirm,
  done,
  send,
  record,
  onLifted,
  onClose,
}: LiftDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<LiftFailure | undefined>(undefined);
  const lift = useMutation({ mutationFn: (trimmed: string) => send(trimmed, idempotencyKey) });
  const trimmed = reason.trim();
  const answer = lift.data;
  const go = (href: string) => () => {
    onClose();
    void navigate(href);
  };

  if (answer !== undefined) {
    return (
      <Dialog
        open
        title={title}
        leading={<IconTile icon={{ name: 'rotate-ccw' }} tone="primary" />}
        actions={[{ label: t('admin.users.lift.close'), variant: 'secondary', onPress: onClose }]}
      >
        <Banner icon={{ name: 'circle-check' }} tone="success">
          {t(done)}
        </Banner>
        {answer.enrollments.length === 0 ? (
          <p className="text-callout tone-muted">{t('admin.users.lift.noEnrollments')}</p>
        ) : (
          <section className="section">
            <h3 className="group-label">{t('admin.users.lift.resultsTitle')}</h3>
            <ul className="stack gap-2" aria-label={t('admin.users.lift.resultsTitle')}>
              {answer.enrollments.map((enrollment) => {
                const href = `/sessions?enrollment=${enrollment.enrollmentId}`;
                return (
                  <li key={enrollment.enrollmentId} className="row wrap gap-2 text-callout">
                    <span>{t(liftResult(enrollment))}</span>
                    <TextLink
                      label={t('admin.users.record.openEnrollment')}
                      href={href}
                      onPress={go(href)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {record === undefined ? null : (
          <span className="self-start">
            <TextLink label={t(record.label)} href={record.href} onPress={go(record.href)} />
          </span>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title={title}
      leading={<IconTile icon={{ name: 'rotate-ccw' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: lift.isPending,
          onPress: onClose,
        },
        {
          label: confirm,
          disabled: trimmed === '',
          loading: lift.isPending,
          onPress: () => {
            if (trimmed === '') return;
            setFailure(undefined);
            lift.mutate(trimmed, {
              onSuccess: onLifted,
              onError: (error) => setFailure(liftFailure(error)),
            });
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        {effects.map((effect) => (
          <p key={effect} className="row row--top gap-2 text-callout">
            <Icon name="info" size="sm" />
            <span>{effect}</span>
          </p>
        ))}
      </section>
      <Field label={t(reasonLabel)}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          <span className="stack gap-2">
            <span>{t(failure.key, failure.values)}</span>
            {failure.enrollmentId === undefined ? null : (
              <span className="self-start">
                <TextLink
                  label={t('admin.users.lift.refused.openFailed')}
                  href={`/sessions?enrollment=${failure.enrollmentId}`}
                  onPress={go(`/sessions?enrollment=${failure.enrollmentId}`)}
                />
              </span>
            )}
          </span>
        </Banner>
      )}
    </Dialog>
  );
}

/** `/users`' lifts: a student's ban, a teacher's ban, a teacher's revocation. */
export type UserLiftKind = 'studentBan' | 'teacherBan' | 'revocation';

export interface UserLiftDialogProps {
  readonly kind: UserLiftKind;
  readonly person: { readonly userId: string; readonly displayName: string };
  /** `users.get`'s `enrollmentsSlotHeldUntil`: the latest hold end, or null for none held. */
  readonly heldUntil: string | null;
  /** `users.get`'s `banRestoreWindowDays` (Q-O2 (a)). */
  readonly days: number;
  readonly onLifted: () => void;
  readonly onClose: () => void;
}

const USER_LIFT: Readonly<
  Record<
    UserLiftKind,
    {
      readonly title: MessageKey;
      readonly effect: MessageKey;
      readonly reason: MessageKey;
      readonly confirm: MessageKey;
      readonly done: MessageKey;
      readonly closing: 'ban' | 'revocation';
    }
  >
> = {
  studentBan: {
    title: 'admin.users.lift.banTitle',
    effect: 'admin.users.lift.studentBan',
    reason: 'admin.users.lift.banReasonLabel',
    confirm: 'admin.users.detail.liftBan',
    done: 'admin.users.lift.doneBan',
    closing: 'ban',
  },
  teacherBan: {
    title: 'admin.users.lift.banTitle',
    effect: 'admin.users.lift.teacherBan',
    reason: 'admin.users.lift.banReasonLabel',
    confirm: 'admin.users.detail.liftBan',
    done: 'admin.users.lift.doneBan',
    closing: 'ban',
  },
  revocation: {
    title: 'admin.users.lift.revocationTitle',
    effect: 'admin.users.lift.revocation',
    reason: 'admin.users.lift.revocationReasonLabel',
    confirm: 'admin.users.detail.liftRevocation',
    done: 'admin.users.lift.doneRevocation',
    closing: 'revocation',
  },
};

export function UserLiftDialog({
  kind,
  person,
  heldUntil,
  days,
  onLifted,
  onClose,
}: UserLiftDialogProps) {
  const t = useT();
  const locale = useLocale();
  const { client } = useAdmin();
  const drawn = USER_LIFT[kind];
  const enrollments =
    heldUntil === null
      ? t('admin.users.lift.enrollmentsNotHeld', { kind: drawn.closing, days })
      : t('admin.users.lift.enrollmentsHeld', {
          kind: drawn.closing,
          days,
          when: instant(heldUntil, t, locale, panelTimeZone()),
        });
  const send = (reason: string, idempotencyKey: string) => {
    if (kind === 'studentBan') {
      return client.api.students.liftBan.mutate({
        studentUserId: person.userId,
        reason,
        idempotencyKey,
      });
    }
    const input = { teacherUserId: person.userId, reason, idempotencyKey };
    return kind === 'teacherBan'
      ? client.api.teachers.liftBan.mutate(input)
      : client.api.teachers.liftRevocation.mutate(input);
  };
  return (
    <LiftDialog
      title={t(drawn.title, { name: person.displayName })}
      effects={[t(drawn.effect), enrollments]}
      reasonLabel={drawn.reason}
      confirm={t(drawn.confirm)}
      done={drawn.done}
      send={send}
      onLifted={onLifted}
      onClose={onClose}
    />
  );
}
