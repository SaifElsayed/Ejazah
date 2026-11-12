// T071 (FR-161): the approval's confirmation (`approveApplication`, screens.md §24; decision 29): its
// effects as FR-PROFILE-10 states them, and a note for the record that is optional (decision 28).
// A refusal of the server's (`APPROVAL_BLOCKED`) is said reason by reason, in the sentences the
// panel uses for the disabled button; any other failure says nothing changed.
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import type { IconName } from '../../design/icons';
import { type MessageKey, useT } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { BLOCKED_TEXT, isBlockedReason } from './decisions';
import { type ApplicationDetail, useApplicationActions } from './queries';

const EFFECTS: readonly (readonly [IconName, MessageKey])[] = [
  ['user-check', 'admin.dialogs.confirm.approveApplication.effects.approved'],
  ['landmark', 'admin.dialogs.confirm.approveApplication.effects.payout'],
  ['bell', 'admin.dialogs.confirm.approveApplication.effects.notified'],
];

export function ApproveDialog({
  detail,
  onClose,
}: {
  readonly detail: ApplicationDetail;
  readonly onClose: () => void;
}) {
  const t = useT();
  const { approve } = useApplicationActions();
  const [note, setNote] = useState('');
  const [refused, setRefused] = useState<readonly ErrorMessage[] | null>(null);

  const confirm = () => {
    setRefused(null);
    const written = note.trim();
    approve.mutate(
      { teacherUserId: detail.teacherUserId, ...(written === '' ? {} : { note: written }) },
      {
        onSuccess: onClose,
        onError: (error) => {
          const reasons =
            errorCodeOf(error) === 'APPROVAL_BLOCKED'
              ? errorDetailsOf(error)
                  .map(({ code }) => code)
                  .filter(isBlockedReason)
                  .map((code): ErrorMessage => ({ key: BLOCKED_TEXT[code] }))
              : [];
          setRefused(
            reasons.length > 0 ? reasons : [errorMessageKey(error, 'admin.dialogs.submitError')],
          );
        },
      },
    );
  };

  return (
    <Dialog
      open
      title={t('admin.dialogs.confirm.approveApplication.title', { name: detail.displayName })}
      leading={<IconTile icon={{ name: 'user-check' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footerNote')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: approve.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.confirm.approveApplication.confirm'),
          loading: approve.isPending,
          onPress: confirm,
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <ul className="stack gap-2 text-callout">
          {EFFECTS.map(([icon, effect]) => (
            <li key={effect} className="row row--top gap-2">
              <Icon name={icon} size="sm" />
              <span>{t(effect, { name: detail.displayName })}</span>
            </li>
          ))}
        </ul>
      </section>
      <Field
        label={t('admin.dialogs.confirm.common.noteLabel')}
        hint={t('admin.dialogs.confirm.common.noteHint')}
      >
        <Input value={note} onChangeText={setNote} multiline />
      </Field>
      {refused === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          <span className="stack gap-1">
            {refused.map((reason) => (
              <span key={reason.key}>{t(reason.key, reason.values)}</span>
            ))}
          </span>
        </Banner>
      )}
    </Dialog>
  );
}
