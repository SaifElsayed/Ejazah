// 006:T021 (FR-706a, FR-706b, FR-709, FR-725, FR-727; SRS DEC-112, DEC-113; admin-surface.md
// `programmes.decide`): the confirmation of one decision on a programme's open item, after
// `pages/gender/DecisionDialog.tsx`. It says what the decision does before anything is sent (and,
// beside a `charge_unknown` extension, the owner's line: a payment found in Paymob is confirmed by
// Paymob itself). On a `no_offer` item it asks what the teacher sent to support, as the
// administrator records it: mandatory, trimmed, 1 to `PROGRAMME_TEXT_MAX_LENGTH` (500) characters,
// so no decision is sent without it (SRS DEC-112; the server refuses it too, `reason_required`).
// Every decision takes an optional note for the audit log (`adminReason`, 1 to 1,000). The key is
// minted when the dialog opens, so a retry after a lost answer is the same decision, and it is sent
// once per press. A refusal is said in place by its cause (`decideFailure`); on success the dialog
// closes, and nothing else opens: a compensation case is the administrator's own act (Q-8 (b)).
import { PROGRAMME_TEXT_MAX_LENGTH } from '@ijazah/contracts';
import { adminReason } from '@ijazah/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import { useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { useProgrammeActions } from './queries';
import { decideFailure, type KindDecision } from './words';

/** The note's bound, the contract's. */
const NOTE_MAX = adminReason.maxLength ?? Number.POSITIVE_INFINITY;

export interface DecideDialogProps {
  readonly requestId: string;
  readonly choice: KindDecision;
  /** Whether the item is a `no_offer` one, whose decision records the teacher's reason. */
  readonly needsReason: boolean;
  /** The extension's window in words, for an effect that says it. */
  readonly window: string | undefined;
  readonly onClose: () => void;
}

export function DecideDialog({
  requestId,
  choice,
  needsReason,
  window,
  onClose,
}: DecideDialogProps) {
  const t = useT();
  const actions = useProgrammeActions();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const send = useMutation({
    mutationFn: (input: { reason: string | undefined; note: string | undefined }) =>
      actions.decide({ requestId, decision: choice.decision, idempotencyKey, ...input }),
  });
  const reasonTrimmed = reason.trim();
  const noteTrimmed = note.trim();
  const reasonTooLong = reasonTrimmed.length > PROGRAMME_TEXT_MAX_LENGTH;
  const reasonSendable = !needsReason || (reasonTrimmed !== '' && !reasonTooLong);
  const sendable = reasonSendable && noteTrimmed.length <= NOTE_MAX;
  const label = t(choice.label);
  const danger = choice.decision === 'approve';
  return (
    <Dialog
      open
      title={t('admin.programme.decide.title', { decision: label })}
      leading={<IconTile icon={{ name: 'layers' }} tone={danger ? 'danger' : 'primary'} />}
      note={t(
        needsReason
          ? 'admin.dialogs.confirm.common.footer'
          : 'admin.dialogs.confirm.common.footerNote',
      )}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: send.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.programme.decide.confirm'),
          variant: danger ? 'danger' : 'primary',
          disabled: !sendable || send.isPending,
          loading: send.isPending,
          onPress: () => {
            if (!sendable) return;
            setFailure(null);
            send.mutate(
              {
                reason: needsReason ? reasonTrimmed : undefined,
                note: noteTrimmed === '' ? undefined : noteTrimmed,
              },
              { onSuccess: onClose, onError: (error) => setFailure(decideFailure(error)) },
            );
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        {choice.effects.map((effect) => (
          <p key={effect} className="row row--top gap-2 text-callout">
            <Icon name="info" size="sm" />
            <span>{t(effect, window === undefined ? undefined : { window })}</span>
          </p>
        ))}
      </section>
      {choice.beside === undefined ? null : (
        <Banner icon={{ name: 'info' }} tone="info">
          {t(choice.beside)}
        </Banner>
      )}
      {needsReason ? (
        <Field
          label={t('admin.programme.decide.reasonLabel')}
          hint={t('admin.programme.decide.reasonHint', { max: PROGRAMME_TEXT_MAX_LENGTH })}
          {...(reasonTooLong
            ? {
                error: t('admin.programme.decide.reasonTooLong', {
                  max: PROGRAMME_TEXT_MAX_LENGTH,
                }),
              }
            : {})}
        >
          <Input
            value={reason}
            onChangeText={setReason}
            multiline
            error={reasonTooLong}
            placeholder={t('admin.programme.decide.reasonRequired')}
          />
        </Field>
      ) : null}
      <Field
        label={t('admin.dialogs.confirm.common.noteLabel')}
        hint={t('admin.dialogs.confirm.common.noteHint')}
      >
        <Input value={note} onChangeText={setNote} multiline />
      </Field>
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}
