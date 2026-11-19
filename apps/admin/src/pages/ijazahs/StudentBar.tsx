// 005:T022 (B49; FR-610; the note under T022): the bar and its lift, offered on an ijazah's student
// and on a request's. No read says whether the student is barred today, so both are offered, and a
// refusal says which one does not apply (`already_barred`, `not_barred`, each in its own words). Each
// asks for a reason; the bar's lift is also offered on each row of the barred list (`BarredList`).
import { useState } from 'react';

import { Button } from '../../design/components';
import { useT } from '../../i18n';
import { ActionDialog } from './ActionDialog';
import { useIjazahActions } from './queries';
import { ijazahFailure } from './words';

export interface BarredStudent {
  readonly userId: string;
  /** Null once the account is deleted. */
  readonly displayName: string | null;
}

/** The student's name, or the words for a deleted account. */
export function useStudentName() {
  const t = useT();
  return (student: BarredStudent) =>
    student.displayName ?? t('admin.users.directory.deletedAccount');
}

/** The bar's two buttons for `student`, each opening its dialog. */
export function StudentBar({ student }: { readonly student: BarredStudent }) {
  const t = useT();
  const [open, setOpen] = useState<'bar' | 'lift' | null>(null);
  return (
    <>
      <span className="row wrap gap-2">
        <Button
          label={t('admin.common.action.barFromIjazahs')}
          variant="secondary"
          onPress={() => setOpen('bar')}
        />
        <Button
          label={t('admin.ijazahs.barred.lift')}
          variant="secondary"
          onPress={() => setOpen('lift')}
        />
      </span>
      {open === 'bar' ? <BarDialog student={student} onClose={() => setOpen(null)} /> : null}
      {open === 'lift' ? <LiftDialog student={student} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

interface DialogOf {
  readonly student: BarredStudent;
  readonly onClose: () => void;
}

export function BarDialog({ student, onClose }: DialogOf) {
  const t = useT();
  const nameOf = useStudentName();
  const actions = useIjazahActions();
  return (
    <ActionDialog
      title={t('admin.dialogs.confirm.barFromIjazahs.title', { name: nameOf(student) })}
      icon="ban"
      tone="danger"
      effects={[
        t('admin.dialogs.confirm.barFromIjazahs.effects.notApproved'),
        t('admin.dialogs.confirm.barFromIjazahs.effects.listed'),
      ]}
      reason={{ label: t('admin.dialogs.confirm.barFromIjazahs.reasonLabel') }}
      confirm={t('admin.dialogs.confirm.barFromIjazahs.confirm')}
      run={(reason, key) => actions.bar(student.userId, reason, key)}
      failureOf={ijazahFailure}
      onClose={onClose}
    />
  );
}

export function LiftDialog({ student, onClose }: DialogOf) {
  const t = useT();
  const nameOf = useStudentName();
  const actions = useIjazahActions();
  return (
    <ActionDialog
      title={t('admin.dialogs.confirm.liftIjazahBar.title', { name: nameOf(student) })}
      icon="rotate-ccw"
      tone="primary"
      effects={[
        t('admin.dialogs.confirm.liftIjazahBar.effects.allowed'),
        t('admin.dialogs.confirm.liftIjazahBar.effects.history'),
      ]}
      reason={{ label: t('admin.dialogs.confirm.liftIjazahBar.reasonLabel') }}
      confirm={t('admin.dialogs.confirm.liftIjazahBar.confirm')}
      run={(reason, key) => actions.liftBar(student.userId, reason, key)}
      failureOf={ijazahFailure}
      onClose={onClose}
    />
  );
}
