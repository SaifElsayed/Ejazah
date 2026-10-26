// T084 (FR-140, ADR 0015 D1, D3, D4): the teacher's deletion (DeleteAccountTeacher), at
// `(teacher)/account/delete`. The board's banner cancels the students' upcoming sessions and has the
// administration contact them about compensation; no student or session exists in this phase, so
// the banner says there is none. «ما يُحذف» says the personal data and, as D3 erases them, the
// application's documents, the uploaded ijazahs and the payout reference, leaving out the signature,
// the public profile, the packages and the slots of later phases; «ما يبقى» leaves out the students'
// ijazahs and the payment and session records, none of which exists yet, and says the activity log
// stays without the personal data (R-HONEST, as in B14d-2 and B15; the board's lines stay in the
// catalogue for their phases). The word, either language's, opens the last confirmation.
import { useT } from '../../../../i18n';
import { DeletionScreen } from '../../../shared/deletion';
import { DeleteAccountTeacherSheet } from '../components/DeleteAccountTeacherSheet';
import { leaveToAccount } from '../navigation';

export function DeleteAccountTeacher() {
  const t = useT();
  return (
    <DeletionScreen
      onLeave={leaveToAccount}
      copy={{
        title: t('teacher.deleteAccount.title'),
        warning: t('teacher.deleteAccount.honest.warning'),
        deletedTitle: t('teacher.deleteAccount.deletedTitle'),
        deleted: [
          t('account.delete.deletedItems.personal'),
          t('teacher.deleteAccount.honest.deletedDocuments'),
        ],
        keptTitle: t('teacher.deleteAccount.keptTitle'),
        kept: [t('account.delete.honest.kept')],
        confirmLabel: t('teacher.deleteAccount.confirmLabel'),
        confirmHint: t('teacher.deleteAccount.confirmHint'),
        submit: t('teacher.deleteAccount.delete'),
        cancel: t('account.delete.cancel'),
      }}
      sheet={(props) => <DeleteAccountTeacherSheet {...props} />}
    />
  );
}
