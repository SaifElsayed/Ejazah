// T084 (FR-140, ADR 0015 D1, D4): the student's deletion (DeleteAccount), at
// `(student)/account/delete`. The board's banner counts the active enrollments with their teacher
// and says the upcoming sessions are cancelled without compensation; no enrollment exists in this
// phase, so the banner says there is none (the count is zero). «ما يُحذف» keeps the personal data
// and leaves out the chats and review comments; «ما يبقى» leaves out the issued ijazahs and the
// payment and session records, none of which exists yet, and says the activity log stays without the
// personal data (R-HONEST, as in B14d-2 and B15; the board's lines stay in the catalogue for their
// phases). The word, either language's, opens the last confirmation.
import { useT } from '../../../../i18n';
import { DeletionScreen } from '../../../shared/deletion';
import { DeleteAccountSheet } from '../components/DeleteAccountSheet';
import { leaveToAccount } from '../navigation';

export function DeleteAccount() {
  const t = useT();
  return (
    <DeletionScreen
      onLeave={leaveToAccount}
      copy={{
        title: t('account.delete.title'),
        warning: t('account.delete.honest.noEnrollments'),
        deletedTitle: t('account.delete.deleted'),
        deleted: [t('account.delete.deletedItems.personal')],
        keptTitle: t('account.delete.kept'),
        kept: [t('account.delete.honest.kept')],
        confirmLabel: t('account.delete.confirmLabel'),
        confirmHint: t('account.delete.irreversible'),
        submit: t('account.delete.submit'),
        cancel: t('account.delete.cancel'),
      }}
      sheet={(props) => <DeleteAccountSheet {...props} />}
    />
  );
}
