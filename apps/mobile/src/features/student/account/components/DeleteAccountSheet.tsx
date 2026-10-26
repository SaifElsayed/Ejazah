// T084 (FR-140, ADR 0015 D1): the student's last confirmation (DeleteAccountSheet): «حذف حسابك
// نهائيًا؟» and the button of the account's method. The board's sentence cancels upcoming sessions,
// which do not exist in this phase, so the honest one says the personal data goes at once and the
// account cannot be restored (R-HONEST; the board's line stays in the catalogue).
import type { MeOutput } from '@ijazah/contracts';

import { useT } from '../../../../i18n';
import { type DeletionConfirmation, DeletionSheet } from '../../../shared/deletion';

export function DeleteAccountSheet({
  me,
  confirmation,
  onClose,
}: {
  readonly me: MeOutput;
  readonly confirmation: DeletionConfirmation;
  readonly onClose: () => void;
}) {
  const t = useT();
  return (
    <DeletionSheet
      method={me.signInMethod}
      confirmation={confirmation}
      onClose={onClose}
      copy={{
        title: t('account.delete.sheet.title'),
        text: t('account.delete.honest.sheetText'),
        confirm: {
          google: t('account.delete.sheet.confirmGoogle'),
          apple: t('account.delete.sheet.confirmApple'),
          email: t('account.delete.sheet.confirmEmail'),
        },
        cancel: t('account.delete.sheet.cancel'),
      }}
    />
  );
}
