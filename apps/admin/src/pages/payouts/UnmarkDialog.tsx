// 003:T105 (SRS DEC-89; the owner's «موافق», 2026-11-18): «التراجع عن الصرف», the undo of a mark made
// in error on one paid release. It says the release is due again and that no money moves, and asks
// for a mandatory reason, trimmed, 1 to the contract's 1,000 characters (`payoutsUnmarkInput`); the
// confirm stays disabled until it is one. Its key is minted when it opens, so a retry after a lost
// answer is the same undo, and it is sent once per press. A refusal is said in place by its code
// (`unmarkFailure`): `NOT_FOUND`, `CONFLICT` (not marked), `RATE_LIMITED` with when to try again.
// After an undo the list and the teacher's detail are read again (`useUnmarkPaid`).
import { payoutsUnmarkInput } from '@ijazah/contracts/admin';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import { useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { useUnmarkPaid } from './queries';
import { unmarkFailure } from './words';

/** The reason's bound, the contract's. */
const REASON_MAX = payoutsUnmarkInput.shape.reason.maxLength ?? Number.POSITIVE_INFINITY;

export interface UnmarkDialogProps {
  readonly releaseId: string;
  readonly teacher: string;
  /** The release's part and amount, in words. */
  readonly lead: string;
  readonly onClose: () => void;
}

export function UnmarkDialog({ releaseId, teacher, lead, onClose }: UnmarkDialogProps) {
  const t = useT();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const unmark = useUnmarkPaid(releaseId, idempotencyKey);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const trimmed = reason.trim();
  const tooLong = trimmed.length > REASON_MAX;
  const sendable = trimmed !== '' && !tooLong;
  return (
    <Dialog
      open
      title={t('admin.money.payouts.unmark.title', { teacher })}
      subtitle={lead}
      leading={<IconTile icon={{ name: 'rotate-ccw' }} tone="primary" />}
      note={t('admin.money.payouts.unmark.footer')}
      actions={[
        {
          label: t('admin.money.payouts.unmark.cancel'),
          variant: 'secondary',
          disabled: unmark.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.money.payouts.unmark.confirm'),
          variant: 'primary',
          disabled: !sendable || unmark.isPending,
          loading: unmark.isPending,
          onPress: () => {
            if (!sendable) return;
            setFailure(null);
            unmark.mutate(trimmed, {
              onSuccess: onClose,
              onError: (error) => setFailure(unmarkFailure(error)),
            });
          },
        },
      ]}
    >
      <p className="row row--top gap-2 text-callout">
        <Icon name="info" size="sm" />
        <span>{t('admin.money.payouts.unmark.effect')}</span>
      </p>
      <Field
        label={t('admin.money.payouts.unmark.reasonLabel')}
        hint={t('admin.money.payouts.unmark.reasonHint', { max: REASON_MAX })}
        {...(tooLong
          ? { error: t('admin.money.payouts.unmark.reasonTooLong', { max: REASON_MAX }) }
          : {})}
      >
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}
