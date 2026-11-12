// T051 (FR-486, FR-ADMIN-5; contracts/admin-surface.md "`students`"): a student's standing, as
// `applications/StandingDialogs.tsx` draws a teacher's. One dialog per action, opened by kind from
// T058's buttons: suspend, ban, reinstate, each with what the server does now and a mandatory reason,
// over `students.suspend`, `students.ban` and `students.reinstate` (T005). `students.*` answer
// nothing, so the board's counts, «the teacher is notified», the enrollment's subtitle and a second
// confirmation are not drawn (the note under T051, Q2), and no word calls a ban final (Q1 (a)). A
// refusal is said in place, `RATE_LIMITED` with when to try again (T058's `errorMessageKey`); after a
// success `onDone` runs, and the caller reads again.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import type { IconName } from '../../design/icons';
import { type MessageKey, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

export type StudentStandingKind = 'suspend' | 'ban' | 'reinstate';

export interface StudentStandingDialogProps {
  readonly kind: StudentStandingKind;
  readonly student: { readonly studentUserId: string; readonly displayName: string };
  /** The dialog closed with nothing sent. */
  readonly onClose: () => void;
  /** The action done: the caller closes the dialog and reads the student again. */
  readonly onDone: () => void;
}

const DRAWN: Readonly<
  Record<
    StudentStandingKind,
    {
      readonly title: MessageKey;
      readonly confirm: MessageKey;
      readonly reason: MessageKey;
      readonly effects: readonly MessageKey[];
      readonly icon: IconName;
      readonly tone: 'danger' | 'primary';
    }
  >
> = {
  suspend: {
    title: 'admin.dialogs.suspendStudent.title',
    confirm: 'admin.dialogs.suspendStudent.confirm',
    reason: 'admin.dialogs.suspendStudent.reasonLabel',
    effects: [
      'admin.dialogs.suspendStudent.honest.suspend.account',
      'admin.dialogs.suspendStudent.honest.suspend.sessions',
      'admin.dialogs.suspendStudent.honest.suspend.enrollments',
      'admin.dialogs.suspendStudent.honest.suspend.remedies',
    ],
    icon: 'ban',
    tone: 'danger',
  },
  ban: {
    title: 'admin.dialogs.suspendStudent.ban.title',
    confirm: 'admin.dialogs.suspendStudent.ban.confirm',
    reason: 'admin.dialogs.suspendStudent.ban.reasonLabel',
    effects: [
      'admin.dialogs.suspendStudent.honest.ban.account',
      'admin.dialogs.suspendStudent.honest.ban.sessions',
      'admin.dialogs.suspendStudent.honest.ban.cases',
    ],
    icon: 'user-x',
    tone: 'danger',
  },
  reinstate: {
    title: 'admin.dialogs.confirm.reactivateAccount.title',
    confirm: 'admin.dialogs.confirm.reactivateAccount.confirm',
    reason: 'admin.dialogs.confirm.reactivateAccount.reasonLabel',
    effects: [
      'admin.dialogs.suspendStudent.honest.reinstate.account',
      'admin.dialogs.suspendStudent.honest.reinstate.cancelled',
      'admin.dialogs.suspendStudent.honest.reinstate.remedies',
    ],
    icon: 'rotate-ccw',
    tone: 'primary',
  },
};

export function StudentStandingDialog({
  kind,
  student,
  onClose,
  onDone,
}: StudentStandingDialogProps) {
  const t = useT();
  const { client } = useAdmin();
  const act = useMutation({
    mutationFn: (reason: string) =>
      client.api.students[kind].mutate({ studentUserId: student.studentUserId, reason }),
  });
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<ErrorMessage | null>(null);
  const drawn = DRAWN[kind];
  return (
    <Dialog
      open
      title={t(drawn.title, { name: student.displayName })}
      leading={<IconTile icon={{ name: drawn.icon }} tone={drawn.tone} />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.suspendStudent.cancel'),
          variant: 'secondary',
          disabled: act.isPending,
          onPress: onClose,
        },
        {
          label: t(drawn.confirm),
          variant: drawn.tone,
          disabled: reason.trim() === '',
          loading: act.isPending,
          onPress: () => {
            setFailed(null);
            act.mutate(reason.trim(), {
              onSuccess: onDone,
              onError: (error) => setFailed(errorMessageKey(error, 'admin.dialogs.submitError')),
            });
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.suspendStudent.effectsTitle')}</h3>
        {drawn.effects.map((effect) => (
          <p key={effect} className="row row--top gap-2 text-callout">
            <Icon name="info" size="sm" />
            <span>{t(effect)}</span>
          </p>
        ))}
      </section>
      <Field label={t(drawn.reason)} hint={t('admin.dialogs.suspendStudent.reasonHint')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.suspendStudent.reasonPlaceholder')}
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
