// B42, T047: the two actions `/sessions` owns, each one dialog with its mandatory reason and no
// second step (Q2), as `applications/StandingDialogs.tsx` asks for its reason. The page mounts a
// dialog only where the server's field allows it (`cancellable`, `restorableUntil`); the server
// decides, and its refusal is said in plain words (`words.ts`).
// - The cancellation (FR-460, `sessions.cancel`): the session becomes Cancelled-By-Admin with no
//   penalty and one compensation case opens on its enrollment, or the open one is joined.
// - The restore (FR-454, FR-455, `sessions.restore`): until when the server says, what a restore
//   does, its idempotency key minted when the dialog opens and reused on its retry, so a lost answer
//   is never a second restore. No word says a closing is final (Q1 (a)).
// Once the server answers, the monitor is read again and the dialog closes.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import type { ErrorMessage } from '../../lib/error-message';
import { panelTimeZone } from '../../lib/zone';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { useRereadMonitor } from './queries';
import { cancelFailure, instant, restoreFailure } from './words';

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
  restorableUntil,
  onClose,
}: {
  readonly enrollmentId: string;
  readonly restorableUntil: string;
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
      lead={t('admin.sessions.restore.until', {
        when: instant(restorableUntil, t, locale, panelTimeZone()),
      })}
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
