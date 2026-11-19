// 005:T022 (B49; FR-604, FR-609, FR-610, FR-629): one confirmation for every ijazah action, on
// both pages. It says what the action does before anything is sent, then asks for the mandatory
// reason when the action takes one, trimmed, 1 to the contract's 1,000 characters (`adminReason`);
// the confirm stays disabled until it is one. Its key is minted when it opens, so a retry after a
// lost answer is the same action, and it is sent once per press. A refusal is said in place by the
// page's own words (`failureOf`); on success the dialog closes.
import { adminReason } from '@ijazah/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import type { IconName } from '../../design/icons';
import { useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';

/** The reason's bound, the contract's. */
const REASON_MAX = adminReason.maxLength ?? Number.POSITIVE_INFINITY;

export interface ActionDialogProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: IconName;
  readonly tone: 'primary' | 'danger';
  /** What happens on confirmation, one line each. */
  readonly effects: readonly string[];
  /** The mandatory reason's field; absent when the action takes none. */
  readonly reason?: {
    readonly label: string;
    readonly hint?: string;
    readonly placeholder?: string;
  };
  readonly confirm: string;
  /** Sends the action with the trimmed reason (empty when it takes none) and the dialog's key. */
  readonly run: (reason: string, idempotencyKey: string) => Promise<unknown>;
  readonly failureOf: (error: unknown) => ErrorMessage;
  readonly onClose: () => void;
}

export function ActionDialog({
  title,
  subtitle,
  icon,
  tone,
  effects,
  reason: field,
  confirm,
  run,
  failureOf,
  onClose,
}: ActionDialogProps) {
  const t = useT();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const send = useMutation({ mutationFn: (reason: string) => run(reason, idempotencyKey) });
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const trimmed = reason.trim();
  const sendable = field === undefined || (trimmed !== '' && trimmed.length <= REASON_MAX);
  return (
    <Dialog
      open
      title={title}
      {...(subtitle === undefined ? {} : { subtitle })}
      leading={<IconTile icon={{ name: icon }} tone={tone} />}
      note={t(
        field === undefined
          ? 'admin.dialogs.confirm.common.footerNote'
          : 'admin.dialogs.confirm.common.footer',
      )}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: send.isPending,
          onPress: onClose,
        },
        {
          label: confirm,
          variant: tone,
          disabled: !sendable || send.isPending,
          loading: send.isPending,
          onPress: () => {
            if (!sendable) return;
            setFailure(null);
            send.mutate(field === undefined ? '' : trimmed, {
              onSuccess: onClose,
              onError: (error) => setFailure(failureOf(error)),
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
      {field === undefined ? null : (
        <Field label={field.label} {...(field.hint === undefined ? {} : { hint: field.hint })}>
          <Input
            value={reason}
            onChangeText={setReason}
            multiline
            placeholder={field.placeholder ?? t('admin.dialogs.confirm.common.reasonPlaceholder')}
          />
        </Field>
      )}
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}
