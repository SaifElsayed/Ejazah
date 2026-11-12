// T071, second part (FR-166): `AdminRequireIdDialog` (screens.md, drawn over the teacher's page): what
// requiring an identity document does, and the reason, mandatory, that the log keeps with it. The
// account becomes «بانتظار إثبات الهوية» on the server (`users.requireIdentity`); the panel offers
// it on an active account with no request open. A refusal is said in place.
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import { useT } from '../../i18n';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { useIdentityActions } from './queries';

export function AdminRequireIdDialog({
  userId,
  name,
  role,
  status,
  onClose,
}: {
  readonly userId: string;
  readonly name: string;
  /** The person's role as the panel names it («معلم», «طالبة»). */
  readonly role: string;
  /** The account's standing as the panel names it («الحساب نشط»). */
  readonly status: string;
  readonly onClose: () => void;
}) {
  const t = useT();
  const { requireIdentity } = useIdentityActions();
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState<ErrorMessage | null>(null);
  const written = reason.trim();

  const confirm = () => {
    setFailed(null);
    requireIdentity.mutate(
      { targetUserId: userId, reason: written },
      { onSuccess: onClose, onError: (error: unknown) => setFailed(errorMessageKey(error, 'admin.dialogs.submitError')) },
    );
  };

  return (
    <Dialog
      open
      title={t('admin.dialogs.requireId.title')}
      subtitle={t('admin.dialogs.requireId.subtitle', { name, role, status })}
      leading={<IconTile icon={{ name: 'user-check' }} tone="warning" />}
      actions={[
        {
          label: t('admin.dialogs.requireId.cancel'),
          variant: 'secondary',
          disabled: requireIdentity.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.requireId.confirm'),
          disabled: written === '',
          loading: requireIdentity.isPending,
          onPress: confirm,
        },
      ]}
    >
      <ul className="stack gap-2 text-callout">
        <li className="row row--top gap-2">
          <Icon name="hourglass" size="sm" />
          <span>
            {t('admin.dialogs.requireId.effectStatusBefore')}
            <strong>{t('admin.dialogs.requireId.effectStatusEmphasis')}</strong>
            {t('admin.dialogs.requireId.effectStatusAfter')}
          </span>
        </li>
        <li className="row row--top gap-2">
          <Icon name="calendar" size="sm" />
          <span>{t('admin.dialogs.requireId.effectBookings')}</span>
        </li>
        <li className="row row--top gap-2">
          <Icon name="upload" size="sm" />
          <span>{t('admin.dialogs.requireId.effectUpload')}</span>
        </li>
        <li className="row row--top gap-2">
          <Icon name="info" size="sm" />
          <span>{t('admin.dialogs.requireId.effectSuspicion')}</span>
        </li>
      </ul>
      <Field
        label={t('admin.dialogs.requireId.reasonLabel')}
        hint={t('admin.dialogs.requireId.reasonHint')}
      >
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.requireId.reasonPlaceholder')}
        />
      </Field>
      {failed !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failed.key, failed.values)}
        </Banner>
      ) : null}
    </Dialog>
  );
}
