// T084 (FR-140, ADR 0015 D1, D3, D4): the teacher's deletion (DeleteAccountTeacher), at
// `(teacher)/account/delete`. The board's banner cancels the students' upcoming sessions and has the
// administration contact them about compensation; no student or session exists in this phase, so
// the banner says there is none. «ما يُحذف» says the personal data and, as D3 erases them, the
// application's documents, the uploaded ijazahs and the payout reference, leaving out the signature,
// the public profile, the packages and the slots of later phases; «ما يبقى» leaves out the students'
// ijazahs and the payment and session records, none of which exists yet, and says the activity log
// stays without the personal data (R-HONEST, as in B14d-2 and B15; the board's lines stay in the
// catalogue for their phases). The word, either language's, opens the last confirmation.
//
// T080 of specs/004-sessions (FR-511; SRS FR-AUTH-14 as amended; the note under T080, Q-O3 (a′),
// Q-F): the banner is the student's neutral sentence, that the deletion is final, saying nothing of
// students; «ما يُحذف» no longer names the documents and the payout reference, for every teacher,
// since a teacher once approved keeps them (T076, the privacy policy's line, T078), so the screen
// is the same for everyone and says nothing the deletion does not do.
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
        warning: t('account.delete.honest.final'),
        deletedTitle: t('teacher.deleteAccount.deletedTitle'),
        deleted: [t('account.delete.deletedItems.personal')],
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
