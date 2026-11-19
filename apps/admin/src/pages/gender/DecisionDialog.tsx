// 005:T023 (B49; FR-612, FR-614 to FR-617): one confirmation for every report and gender-flag
// decision, after lane B's `pages/ijazahs/ActionDialog.tsx`. It says what the decision does before
// anything is sent (and, for a correction, what it ends: `children`), then asks for the mandatory
// reason, trimmed, 1 to the contract's 1,000 characters (`adminReason`), and, where the decision takes
// one, a second field (the person's account id of a flag raised alone, the note an applicant sees
// of a fraud ban): required or not, checked by its own rule. The confirm stays disabled until both
// are sendable. Its key is minted when it opens, so a retry after a lost answer is the same decision,
// and it is sent once per press. A refusal is said in place by the page's own words (`failureOf`);
// on success the dialog closes.
import { adminReason } from '@ijazah/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import type { IconName } from '../../design/icons';
import { useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';

/** The reason's bound, the contract's. */
const REASON_MAX = adminReason.maxLength ?? Number.POSITIVE_INFINITY;

/** The second field: its words, whether it must be written, and what a written value must be. */
export interface ExtraField {
  readonly label: string;
  readonly hint?: string;
  readonly required: boolean;
  /** The trimmed value's rule when written; within the reason's bound when absent. */
  readonly valid?: (value: string) => boolean;
  /** Written left to right (an id). */
  readonly ltr?: boolean;
}

export interface DecisionDialogProps {
  readonly title: string;
  readonly icon: IconName;
  readonly tone: 'primary' | 'danger';
  /** What happens on confirmation, one line each. */
  readonly effects: readonly string[];
  /** What the decision acts on, drawn below the effects. */
  readonly children?: ReactNode;
  readonly reasonLabel: string;
  readonly extra?: ExtraField;
  readonly confirm: string;
  /** Sends the decision with the trimmed reason, the trimmed second value (or none) and the key. */
  readonly run: (
    reason: string,
    extra: string | undefined,
    idempotencyKey: string,
  ) => Promise<unknown>;
  readonly failureOf: (error: unknown) => ErrorMessage;
  readonly onClose: () => void;
}

const withinBound = (value: string) => value.length <= REASON_MAX;

export function DecisionDialog({
  title,
  icon,
  tone,
  effects,
  children,
  reasonLabel,
  extra,
  confirm,
  run,
  failureOf,
  onClose,
}: DecisionDialogProps) {
  const t = useT();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const send = useMutation({
    mutationFn: ({ reason, second }: { reason: string; second: string | undefined }) =>
      run(reason, second, idempotencyKey),
  });
  const [reason, setReason] = useState('');
  const [second, setSecond] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const trimmed = reason.trim();
  const secondTrimmed = second.trim();
  const secondSendable =
    extra === undefined ||
    (secondTrimmed === '' ? !extra.required : (extra.valid ?? withinBound)(secondTrimmed));
  const sendable = trimmed !== '' && withinBound(trimmed) && secondSendable;
  return (
    <Dialog
      open
      title={title}
      leading={<IconTile icon={{ name: icon }} tone={tone} />}
      note={t('admin.dialogs.confirm.common.footer')}
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
            send.mutate(
              { reason: trimmed, second: secondTrimmed === '' ? undefined : secondTrimmed },
              {
                onSuccess: onClose,
                onError: (error) => setFailure(failureOf(error)),
              },
            );
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
      {children}
      <Field label={reasonLabel}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {extra === undefined ? null : (
        <Field label={extra.label} {...(extra.hint === undefined ? {} : { hint: extra.hint })}>
          <Input
            value={second}
            onChangeText={setSecond}
            ltr={extra.ltr === true}
            multiline={extra.ltr !== true}
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
