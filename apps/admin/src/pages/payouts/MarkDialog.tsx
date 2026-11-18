// 003:T105 (SRS DEC-89, DEC-81, FR-PAYG-11): «تم الصرف», the confirmation of one written due release.
// It says the transfer is made by hand in Paymob's dashboard and that this records the fact and moves
// no money; its key is minted when it opens, so a retry after a lost answer is the same mark
// (`idempotent-procedures.ts`), and it is sent once per press. A refusal is said in place by its
// code (`markFailure`): `NOT_FOUND`, `CONFLICT` (already marked), `RATE_LIMITED` with when to try
// again. After a mark the list and the teacher's detail are read again (`useMarkPaid`).
import { useState } from 'react';

import { Banner, Dialog, Icon, IconTile } from '../../design/components';
import { useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { useMarkPaid } from './queries';
import { markFailure } from './words';

export interface MarkDialogProps {
  readonly releaseId: string;
  readonly teacher: string;
  /** The release's part and amount, in words. */
  readonly lead: string;
  readonly onClose: () => void;
}

export function MarkDialog({ releaseId, teacher, lead, onClose }: MarkDialogProps) {
  const t = useT();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const mark = useMarkPaid(releaseId, idempotencyKey);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  return (
    <Dialog
      open
      title={t('admin.money.payouts.mark.title', { teacher })}
      subtitle={lead}
      leading={<IconTile icon={{ name: 'credit-card' }} tone="primary" />}
      note={t('admin.money.payouts.mark.footer')}
      actions={[
        {
          label: t('admin.money.payouts.mark.cancel'),
          variant: 'secondary',
          disabled: mark.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.money.payouts.mark.confirm'),
          variant: 'primary',
          disabled: mark.isPending,
          loading: mark.isPending,
          onPress: () => {
            setFailure(null);
            mark.mutate(undefined, {
              onSuccess: onClose,
              onError: (error) => setFailure(markFailure(error)),
            });
          },
        },
      ]}
    >
      <p className="row row--top gap-2 text-callout">
        <Icon name="info" size="sm" />
        <span>{t('admin.money.payouts.mark.effect')}</span>
      </p>
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}
