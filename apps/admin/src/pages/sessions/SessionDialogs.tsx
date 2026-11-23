// B42, T047: the two actions `/sessions` owns, each one dialog with its mandatory reason and no
// second step (Q2), as `applications/StandingDialogs.tsx` asks for its reason. The page mounts a
// dialog only where the server's field allows it (`cancellable`, `restorableUntil`); the server
// decides, and its refusal is said in plain words (`words.ts`).
// - The cancellation (FR-460, `sessions.cancel`): the session becomes Cancelled-By-Admin with no
//   penalty and one compensation case opens on its enrollment, or the open one is joined.
// - The restore (FR-454, FR-455, `sessions.restore`): until when the server says, what a restore
//   does, its idempotency key minted when the dialog opens and reused on its retry, so a lost answer
//   is never a second restore. No word says a closing is final (Q1 (a)).
// - B42b, T075 (FR-503; SRS FR-CANCEL-9, DEC-69): the restore says the slot is held until T070's
//   `slotHeldUntil`, or was released at `slotReleasedAt`, and that it succeeds afterwards while the
//   slot is free; the release (`enrollments.releaseSlot`), shown on a held slot, says until when it
//   is held and that the release cannot be undone (a restore after it succeeds only while the slot
//   stays free), with its key minted when the dialog opens and reused on its retry.
// - B42c, T083 (FR-513, FR-514; SRS FR-CANCEL-10, DEC-68; T082's `sessions.endEnrollment`): the
//   end of a confirmed enrollment says what it does and that a release cannot be undone, asks for
//   the parties' reason (mandatory) and an internal note (optional), and offers the slot held for
//   the monitor's `enrollmentRestoreWindowDays` (the default) or released now; its key minted when
//   the dialog opens and reused on its retry; `complaint_open` links to the complaint.
// - 003:T112 (SRS FR-POSTPONE-6, DEC-90; Q-4 (a)): the end's cause, the direct end (the default,
//   sent as before, with no `cause`) or a complaint against the student (a teacher's report),
//   which says what that close does and is sent as `cause: 'student_complaint_ended'`. That close
//   frees the slot (the T112 note, «releasing the slot»; FR-POSTPONE-6; PR #151's review, round 1,
//   Major 2 (a)): with it the slot's choice shows «release now» alone, selected, with a line saying
//   why, and sends `release`; the direct end gives the administrator's choice back.
// - 003:T125 (SRS DEC-104; Q-1 (a)): the direct end names who stopped: «الطالب قرر يوقف» (the
//   default, `admin_ended`, sent as before) or «المعلم وقف» (`cause: 'teacher_ended'`, the slot as
//   chosen), each with a line saying what it does.
// Once the server answers, the monitor is read again and the dialog closes.
import type { EnrollmentEndCause, EnrollmentEndSlot } from '@ijazah/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Banner,
  Choice,
  ChoiceGroup,
  Dialog,
  Field,
  Icon,
  IconTile,
  Input,
  TextLink,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import type { ErrorMessage } from '../../lib/error-message';
import { panelTimeZone } from '../../lib/zone';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { useRereadMonitor } from './queries';
import {
  cancelFailure,
  type EndFailure,
  endFailure,
  instant,
  releaseFailure,
  restoreFailure,
  type SlotHold,
} from './words';

interface DialogShellProps {
  readonly title: string;
  readonly icon: 'calendar' | 'rotate-ccw';
  readonly lead?: string;
  readonly effect: string;
  readonly reasonLabel: string;
  readonly confirm: string;
  readonly pending: boolean;
  readonly failure: ErrorMessage | undefined;
  readonly onSend: (reason: string) => void;
  readonly onClose: () => void;
}

/** One action's dialog: what it does, its mandatory reason, and the refusal said in place. */
function ReasonDialog({
  title,
  icon,
  lead,
  effect,
  reasonLabel,
  confirm,
  pending,
  failure,
  onSend,
  onClose,
}: DialogShellProps) {
  const t = useT();
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Dialog
      open
      title={title}
      leading={<IconTile icon={{ name: icon }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: pending,
          onPress: onClose,
        },
        {
          label: confirm,
          disabled: trimmed === '',
          loading: pending,
          onPress: () => {
            if (trimmed === '') return;
            onSend(trimmed);
          },
        },
      ]}
    >
      {lead === undefined ? null : <p className="text-callout">{lead}</p>}
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{effect}</span>
        </p>
      </section>
      <Field label={reasonLabel}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}

export function CancelSessionDialog({
  sessionId,
  sequenceNumber,
  onClose,
}: {
  readonly sessionId: string;
  readonly sequenceNumber: number;
  readonly onClose: () => void;
}) {
  const t = useT();
  const { client } = useAdmin();
  const reread = useRereadMonitor();
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const cancel = useMutation({
    mutationFn: (reason: string) => client.api.sessions.cancel.mutate({ sessionId, reason }),
  });
  return (
    <ReasonDialog
      title={t('admin.sessions.cancel.title', { n: sequenceNumber })}
      icon="calendar"
      effect={t('admin.sessions.cancel.effect')}
      reasonLabel={t('admin.sessions.cancel.reasonLabel')}
      confirm={t('admin.sessions.cancel.confirm')}
      pending={cancel.isPending}
      failure={failure}
      onClose={onClose}
      onSend={(reason) => {
        setFailure(undefined);
        cancel.mutate(reason, {
          onSuccess: () => {
            void reread();
            onClose();
          },
          onError: (error) => setFailure(cancelFailure(error)),
        });
      }}
    />
  );
}

export function RestoreDialog({
  enrollmentId,
  hold,
  onClose,
}: {
  readonly enrollmentId: string;
  /** T075: the slot held until when, or released when. */
  readonly hold: SlotHold;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { client } = useAdmin();
  const reread = useRereadMonitor();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const restore = useMutation({
    mutationFn: (reason: string) =>
      client.api.sessions.restore.mutate({ enrollmentId, reason, idempotencyKey }),
  });
  return (
    <ReasonDialog
      title={t('admin.sessions.restore.title')}
      icon="rotate-ccw"
      lead={
        hold.state === 'held'
          ? t('admin.sessions.restore.until', {
              when: instant(hold.until, t, locale, panelTimeZone()),
            })
          : t('admin.sessions.restore.released', {
              when: instant(hold.at, t, locale, panelTimeZone()),
            })
      }
      effect={t('admin.sessions.restore.effect')}
      reasonLabel={t('admin.sessions.restore.reasonLabel')}
      confirm={t('admin.sessions.restore.confirm')}
      pending={restore.isPending}
      failure={failure}
      onClose={onClose}
      onSend={(reason) => {
        setFailure(undefined);
        restore.mutate(reason, {
          onSuccess: () => {
            void reread();
            onClose();
          },
          onError: (error) => setFailure(restoreFailure(error)),
        });
      }}
    />
  );
}

/** T075 (FR-503): a held slot's release, its key minted when the dialog opens. */
export function ReleaseSlotDialog({
  enrollmentId,
  slotHeldUntil,
  onClose,
}: {
  readonly enrollmentId: string;
  readonly slotHeldUntil: string;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { client } = useAdmin();
  const reread = useRereadMonitor();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const release = useMutation({
    mutationFn: (reason: string) =>
      client.api.enrollments.releaseSlot.mutate({ enrollmentId, reason, idempotencyKey }),
  });
  return (
    <ReasonDialog
      title={t('admin.sessions.release.title')}
      icon="calendar"
      lead={t('admin.sessions.release.until', {
        when: instant(slotHeldUntil, t, locale, panelTimeZone()),
      })}
      effect={t('admin.sessions.release.effect')}
      reasonLabel={t('admin.sessions.release.reasonLabel')}
      confirm={t('admin.sessions.release.confirm')}
      pending={release.isPending}
      failure={failure}
      onClose={onClose}
      onSend={(reason) => {
        setFailure(undefined);
        release.mutate(reason, {
          onSuccess: () => {
            void reread();
            onClose();
          },
          onError: (error) => setFailure(releaseFailure(error)),
        });
      }}
    />
  );
}

/** What the end sends: the parties' reason, the note when written, the slot's choice and its cause. */
interface EndInput {
  readonly partyReason: string;
  readonly internalNote: string;
  readonly slot: EnrollmentEndSlot;
  readonly cause: EnrollmentEndCause;
}

/** T083 (FR-513): a confirmed enrollment's end, its key minted when the dialog opens. */
export function EndEnrollmentDialog({
  enrollmentId,
  days,
  onClose,
}: {
  readonly enrollmentId: string;
  /** `sessions.monitor.get`'s `enrollmentRestoreWindowDays` (Q-O1 (a)). */
  readonly days: number;
  readonly onClose: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { client } = useAdmin();
  const reread = useRereadMonitor();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [partyReason, setPartyReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [slot, setSlot] = useState<EnrollmentEndSlot>('hold');
  const [cause, setCause] = useState<EnrollmentEndCause>('admin_ended');
  const [failure, setFailure] = useState<EndFailure | undefined>(undefined);
  const end = useMutation({
    mutationFn: (input: EndInput) =>
      client.api.sessions.endEnrollment.mutate({
        enrollmentId,
        partyReason: input.partyReason,
        ...(input.internalNote === '' ? {} : { internalNote: input.internalNote }),
        slot: input.slot,
        // 003:T112 (Q-4 (a)): the direct end is the server's default, sent as before.
        ...(input.cause === 'admin_ended' ? {} : { cause: input.cause }),
        idempotencyKey,
      }),
  });
  const reason = partyReason.trim();
  // 003:T112 (Major 2 (a)): a close on a complaint against the student always releases the slot.
  const complaintClose = cause === 'student_complaint_ended';
  const sentSlot: EnrollmentEndSlot = complaintClose ? 'release' : slot;
  const complaintHref =
    failure?.complaintId === undefined ? undefined : `/cases?case=${failure.complaintId}`;

  const send = () => {
    if (reason === '') return;
    setFailure(undefined);
    end.mutate(
      { partyReason: reason, internalNote: internalNote.trim(), slot: sentSlot, cause },
      {
        onSuccess: () => {
          void reread();
          onClose();
        },
        onError: (error) => setFailure(endFailure(error)),
      },
    );
  };

  return (
    <Dialog
      open
      title={t('admin.sessions.end.title')}
      leading={<IconTile icon={{ name: 'circle-x' }} tone="danger" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: end.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.sessions.end.confirm'),
          variant: 'danger',
          disabled: reason === '',
          loading: end.isPending,
          onPress: send,
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        {[t('admin.sessions.end.effect'), t('admin.sessions.end.releaseFinal')].map((effect) => (
          <p key={effect} className="row row--top gap-2 text-callout">
            <Icon name="info" size="sm" />
            <span>{effect}</span>
          </p>
        ))}
      </section>
      <ChoiceGroup legend={t('admin.sessions.endCause.legend')}>
        <Choice
          label={t('admin.sessions.endCause.adminEnded')}
          selected={cause === 'admin_ended'}
          onPress={() => setCause('admin_ended')}
        />
        {/* 003:T125 (SRS DEC-104; Q-1 (a)): who stopped, the teacher's stop sent as its cause. */}
        <Choice
          label={t('admin.sessions.endCause.teacherEnded')}
          selected={cause === 'teacher_ended'}
          onPress={() => setCause('teacher_ended')}
        />
        <Choice
          label={t('admin.sessions.endCause.studentComplaintEnded')}
          selected={cause === 'student_complaint_ended'}
          onPress={() => setCause('student_complaint_ended')}
        />
      </ChoiceGroup>
      {cause === 'student_complaint_ended' ? null : (
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>
            {t(
              cause === 'teacher_ended'
                ? 'admin.sessions.endCause.teacherEndedEffect'
                : 'admin.sessions.endCause.adminEndedEffect',
            )}
          </span>
        </p>
      )}
      {cause === 'student_complaint_ended' ? (
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.sessions.endCause.studentComplaintEffect')}</span>
        </p>
      ) : null}
      <Field label={t('admin.sessions.end.reasonLabel')}>
        <Input
          value={partyReason}
          onChangeText={setPartyReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      <Field label={t('admin.sessions.end.noteLabel')}>
        <Input value={internalNote} onChangeText={setInternalNote} multiline />
      </Field>
      <ChoiceGroup legend={t('admin.sessions.end.slotLegend')}>
        {complaintClose ? null : (
          <Choice
            label={t('admin.sessions.end.slot.hold', { days })}
            selected={sentSlot === 'hold'}
            onPress={() => setSlot('hold')}
          />
        )}
        <Choice
          label={t('admin.sessions.end.slot.release')}
          selected={sentSlot === 'release'}
          danger
          onPress={() => setSlot('release')}
        />
      </ChoiceGroup>
      {complaintClose ? (
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.sessions.endCause.slotReleased')}</span>
        </p>
      ) : null}
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          <span className="stack gap-2">
            <span>{t(failure.key, failure.values)}</span>
            {complaintHref === undefined ? null : (
              <span className="self-start">
                <TextLink
                  label={t('admin.sessions.end.refused.openComplaint')}
                  href={complaintHref}
                  onPress={() => void navigate(complaintHref)}
                />
              </span>
            )}
          </span>
        </Banner>
      )}
    </Dialog>
  );
}
