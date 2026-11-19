// 005:T023 (B49; FR-614; SRS FR-GENDER-3; the note under T023): an administrator raises a gender
// flag, from a report (its reported person and its id, the reports page) or on a person named by
// their account's id (this page's own button). Either takes a reason and a key; the answer is the
// new open flag, and the refusals (`open_exists`, `report_target_mismatch`, `NOT_FOUND`) are said in
// their own words.
import { adminGenderFlagsRaiseInput } from '@ijazah/contracts/admin';

import { useT } from '../../i18n';
import { DecisionDialog } from './DecisionDialog';
import { useGenderActions } from './queries';
import { genderFlagFailure } from './words';

/** An account id as the contract takes it. */
const isAccountId = (value: string) =>
  adminGenderFlagsRaiseInput.shape.targetUserId.safeParse(value).success;

export interface RaiseFlagDialogProps {
  /** A flag raised from a report: its reported person and its id. Absent: the person's id is asked. */
  readonly fromReport?: { readonly reportId: string; readonly reportedUserId: string };
  readonly onClose: () => void;
}

export function RaiseFlagDialog({ fromReport, onClose }: RaiseFlagDialogProps) {
  const t = useT();
  const actions = useGenderActions();
  return (
    <DecisionDialog
      title={t('admin.dialogs.confirm.raiseGenderFlag.title')}
      icon="flag"
      tone="primary"
      effects={[
        t('admin.dialogs.confirm.raiseGenderFlag.effects.queued'),
        t('admin.dialogs.confirm.raiseGenderFlag.effects.unchanged'),
      ]}
      reasonLabel={t('admin.dialogs.confirm.raiseGenderFlag.reasonLabel')}
      {...(fromReport === undefined
        ? {
            extra: {
              label: t('admin.gender.raiseTargetLabel'),
              hint: t('admin.gender.raiseTargetHint'),
              required: true,
              valid: isAccountId,
              ltr: true,
            },
          }
        : {})}
      confirm={t('admin.dialogs.confirm.raiseGenderFlag.confirm')}
      run={(reason, target, key) =>
        fromReport === undefined
          ? actions.raise(target ?? '', reason, undefined, key)
          : actions.raise(fromReport.reportedUserId, reason, fromReport.reportId, key)
      }
      failureOf={genderFlagFailure}
      onClose={onClose}
    />
  );
}
