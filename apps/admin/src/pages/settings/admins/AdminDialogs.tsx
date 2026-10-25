// T073 (FR-173, FR-174): the administrators' dialogs. Adding one by name and work address
// (`AdminAddAdminDialog`), an address already taken said in place; resetting another's second factor
// (`AdminMfaResetDialog`) and disabling another's account (`disableAdmin`), each with its effects
// and a reason; and new recovery codes on one's own account for a current code of one's own second
// factor (T096), shown once, the dialog closing once they are saved.
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input, Otp } from '../../../design/components';
import type { IconName } from '../../../design/icons';
import { type MessageKey, useLocale, useT } from '../../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { dayMonthYear } from '../../../lib/format';
import { panelTimeZone } from '../../../lib/zone';
import { RecoveryCodes } from '../../mfa/RecoveryCodes';
import { type AdminRow, useAdminActions } from './queries';

const CODE_LENGTH = 6;

function Effects({ effects }: { readonly effects: readonly (readonly [IconName, string])[] }) {
  return (
    <ul className="stack gap-2 text-callout">
      {effects.map(([icon, text]) => (
        <li key={text} className="row row--top gap-2">
          <Icon name={icon} size="sm" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

export function AddAdminDialog({ onClose }: { readonly onClose: () => void }) {
  const t = useT();
  const { add } = useAdminActions();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [refused, setRefused] = useState<MessageKey | null>(null);
  const [taken, setTaken] = useState(false);
  const ready = name.trim() !== '' && email.trim() !== '';
  const send = () => {
    setRefused(null);
    setTaken(false);
    add.mutate(
      { displayName: name.trim(), email: email.trim() },
      {
        onSuccess: onClose,
        onError: (error) => {
          if (
            errorCodeOf(error) === 'CONFLICT' &&
            errorDetailsOf(error).some(({ path, code }) => path === 'email' && code === 'taken')
          ) {
            setTaken(true);
          } else {
            setRefused('admin.dialogs.submitError');
          }
        },
      },
    );
  };
  return (
    <Dialog
      open
      title={t('admin.dialogs.addAdmin.title')}
      subtitle={t('admin.dialogs.addAdmin.lede')}
      leading={<IconTile icon={{ name: 'user' }} tone="primary" />}
      note={t('admin.dialogs.addAdmin.auditHint')}
      actions={[
        {
          label: t('admin.dialogs.addAdmin.cancel'),
          variant: 'secondary',
          disabled: add.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.addAdmin.send'),
          disabled: !ready,
          loading: add.isPending,
          onPress: send,
        },
      ]}
    >
      <Field label={t('admin.dialogs.addAdmin.name')}>
        <Input value={name} onChangeText={setName} />
      </Field>
      <Field
        label={t('admin.dialogs.addAdmin.workEmail')}
        {...(taken ? { error: t('admin.dialogs.addAdmin.emailTaken') } : {})}
      >
        <Input
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setTaken(false);
          }}
          keyboard="email"
          ltr
          error={taken}
        />
      </Field>
      <Effects
        effects={[
          ['mail', t('admin.dialogs.addAdmin.inviteHint')],
          ['shield-check', t('admin.dialogs.addAdmin.mfaHint')],
        ]}
      />
      {refused === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(refused)}
        </Banner>
      )}
    </Dialog>
  );
}

export function MfaResetDialog({
  admin,
  onClose,
}: {
  readonly admin: AdminRow;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { resetMfa } = useAdminActions();
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);
  const since =
    admin.invitedAt === undefined ? null : dayMonthYear(admin.invitedAt, locale, panelTimeZone());
  return (
    <Dialog
      open
      title={t('admin.dialogs.mfaReset.title', { name: admin.displayName })}
      subtitle={
        since === null
          ? admin.email
          : t('admin.dialogs.mfaReset.subtitle', { email: admin.email, date: since })
      }
      leading={<IconTile icon={{ name: 'key-round' }} tone="warning" />}
      actions={[
        {
          label: t('admin.dialogs.mfaReset.cancel'),
          variant: 'secondary',
          disabled: resetMfa.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.mfaReset.confirm'),
          disabled: reason.trim() === '',
          loading: resetMfa.isPending,
          onPress: () => {
            setFailed(false);
            resetMfa.mutate(
              { adminId: admin.adminId, reason: reason.trim() },
              { onSuccess: onClose, onError: () => setFailed(true) },
            );
          },
        },
      ]}
    >
      <Effects
        effects={[
          ['x', t('admin.dialogs.mfaReset.effects.revoked')],
          ['refresh-cw', t('admin.dialogs.mfaReset.effects.nextSignIn')],
          ['lock', t('admin.dialogs.mfaReset.effects.sessionsEnded')],
          ['list', t('admin.dialogs.mfaReset.effects.audited')],
        ]}
      />
      <Field
        label={t('admin.dialogs.mfaReset.reasonLabel')}
        hint={t('admin.dialogs.mfaReset.verifyHint')}
      >
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.mfaReset.reasonPlaceholder')}
        />
      </Field>
      {failed ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('admin.dialogs.submitError')}
        </Banner>
      ) : null}
    </Dialog>
  );
}

export function DisableAdminDialog({
  admin,
  onClose,
}: {
  readonly admin: AdminRow;
  readonly onClose: () => void;
}) {
  const t = useT();
  const { disable } = useAdminActions();
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <Dialog
      open
      title={t('admin.dialogs.confirm.disableAdmin.title', { name: admin.displayName })}
      leading={<IconTile icon={{ name: 'user-x' }} tone="danger" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: disable.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.confirm.disableAdmin.confirm'),
          variant: 'danger',
          disabled: reason.trim() === '',
          loading: disable.isPending,
          onPress: () => {
            setFailed(false);
            disable.mutate(
              { adminId: admin.adminId, reason: reason.trim() },
              { onSuccess: onClose, onError: () => setFailed(true) },
            );
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <Effects
          effects={[
            ['lock', t('admin.dialogs.confirm.disableAdmin.effects.noSignIn')],
            ['list', t('admin.dialogs.confirm.disableAdmin.effects.audit')],
          ]}
        />
      </section>
      <Field label={t('admin.dialogs.confirm.disableAdmin.reasonLabel')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failed ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('admin.dialogs.submitError')}
        </Banner>
      ) : null}
    </Dialog>
  );
}

export function RecoveryCodesDialog({ onClose }: { readonly onClose: () => void }) {
  const t = useT();
  const { regenerate } = useAdminActions();
  const [code, setCode] = useState('');
  const [refused, setRefused] = useState<MessageKey | null>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const create = () => {
    setRefused(null);
    regenerate.mutate(
      { code },
      {
        onSuccess: ({ recoveryCodes }) => setCodes(recoveryCodes),
        onError: (error) =>
          setRefused(
            errorCodeOf(error) === 'CODE_INVALID'
              ? 'admin.admins.recovery.codeInvalid'
              : 'admin.dialogs.submitError',
          ),
      },
    );
  };
  return (
    <Dialog
      open
      title={t('admin.admins.recovery.title')}
      leading={<IconTile icon={{ name: 'key-round' }} tone="primary" />}
      actions={
        codes === null
          ? [
              {
                label: t('admin.dialogs.confirm.common.cancel'),
                variant: 'secondary',
                disabled: regenerate.isPending,
                onPress: onClose,
              },
              {
                label: t('admin.admins.recovery.confirm'),
                disabled: code.length !== CODE_LENGTH,
                loading: regenerate.isPending,
                onPress: create,
              },
            ]
          : [{ label: t('admin.admins.recovery.done'), disabled: !saved, onPress: onClose }]
      }
    >
      {codes === null ? (
        <>
          <p className="text-callout tone-muted">{t('admin.admins.recovery.text')}</p>
          <div className="field">
            <span className="field__label">{t('admin.admins.recovery.codeLabel')}</span>
            <Otp
              value={code}
              onChange={(value) => {
                setCode(value);
                setRefused(null);
              }}
              error={refused !== null}
            />
          </div>
          {refused === null ? null : (
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              {t(refused)}
            </Banner>
          )}
        </>
      ) : (
        <RecoveryCodes codes={codes} saved={saved} onSaved={setSaved} />
      )}
    </Dialog>
  );
}
