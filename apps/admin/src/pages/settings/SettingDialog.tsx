// 005:T024 (B49; FR-624; the note under T024): the change of one setting. It opens on the value now,
// in the setting's shape (one number, numbers separated by commas, a rate limit's two numbers, or a
// text), says before anything is sent that the change applies at once to every later read (the
// signed-in default's within 60 s, `SIGNED_IN_DEFAULT`), and asks for the mandatory reason, trimmed,
// 1 to the contract's 1,000 characters (`adminReason`); the confirm stays disabled until the value
// and the reason are both there. Its key is minted when it opens, so a retry after a lost answer is
// the same change, and it is sent once per press (`settings.update`). A refusal is said in place by
// its own words (`changeFailure`); on success the dialog closes and the list is read again.
import { adminReason } from '@ijazah/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import { useLocale, useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { type SettingRow, useSettingChange } from './queries';
import {
  boundsText,
  changeFailure,
  type Draft,
  draftOf,
  labelKey,
  parsedDraft,
  SIGNED_IN_DEFAULT,
  valueText,
} from './words';

/** The reason's bound, the contract's. */
const REASON_MAX = adminReason.maxLength ?? Number.POSITIVE_INFINITY;

export function SettingDialog({
  setting,
  onClose,
}: {
  readonly setting: SettingRow;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const change = useSettingChange();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [draft, setDraft] = useState<Draft>(() => draftOf(setting));
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  const send = useMutation({
    mutationFn: (asked: {
      readonly value: NonNullable<SettingRow['value']>;
      readonly reason: string;
    }) => change({ key: setting.key, value: asked.value, reason: asked.reason, idempotencyKey }),
  });

  // 006:T002 (Q-6): the setting's unit, so an amount is typed in pounds and sent in piasters.
  const value = parsedDraft(setting, draft);
  const trimmed = reason.trim();
  const sendable =
    value !== undefined && value !== null && trimmed !== '' && trimmed.length <= REASON_MAX;
  const bounds = boundsText(t, locale, setting);
  const effect =
    setting.key === SIGNED_IN_DEFAULT
      ? 'admin.dialogs.confirm.changeSetting.effects.withinMinute'
      : 'admin.dialogs.confirm.changeSetting.effects.everyRead';

  const field = (
    label: Parameters<typeof t>[0],
    text: string,
    write: (next: string) => void,
    hint?: string,
  ) => (
    <Field label={t(label)} {...(hint === undefined ? {} : { hint })}>
      <Input
        value={text}
        onChangeText={write}
        ltr
        {...(setting.bounds.shape === 'text' || setting.bounds.shape === 'list'
          ? {}
          : { keyboard: 'numeric' as const })}
      />
    </Field>
  );

  return (
    <Dialog
      open
      title={t('admin.dialogs.confirm.changeSetting.title', { setting: t(labelKey(setting.key)) })}
      subtitle={t('admin.dialogs.confirm.changeSetting.subtitle', {
        value: valueText(t, locale, setting),
      })}
      leading={<IconTile icon={{ name: 'sliders-horizontal' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: send.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.dialogs.confirm.changeSetting.confirm'),
          variant: 'primary',
          disabled: !sendable || send.isPending,
          loading: send.isPending,
          onPress: () => {
            if (!sendable) return;
            setFailure(null);
            send.mutate(
              { value, reason: trimmed },
              {
                onSuccess: onClose,
                onError: (error) => setFailure(changeFailure(error, bounds)),
              },
            );
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="triangle-alert" size="sm" />
          <span>{t(effect)}</span>
        </p>
      </section>
      {setting.bounds.shape === 'rate_limit' ? (
        <>
          {field(
            'admin.dialogs.confirm.changeSetting.limitLabel',
            draft.first,
            (first) => setDraft({ ...draft, first }),
            bounds,
          )}
          {field('admin.dialogs.confirm.changeSetting.windowLabel', draft.second, (second) =>
            setDraft({ ...draft, second }),
          )}
        </>
      ) : (
        field(
          'admin.dialogs.confirm.changeSetting.valueLabel',
          draft.first,
          (first) => setDraft({ ...draft, first }),
          setting.bounds.shape === 'list'
            ? `${t('admin.dialogs.confirm.changeSetting.listHint')} · ${bounds}`
            : bounds,
        )
      )}
      <Field label={t('admin.settings.reasonLabel')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.settings.reasonPlaceholder')}
        />
      </Field>
      {failure === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}
