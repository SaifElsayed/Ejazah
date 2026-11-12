// B14b-2 (FR-166): the confirmations of the viewer's two decisions (`acceptDocument` and
// `requestAnotherDocument`, screens.md §24): what follows, then the call. The note was written in the
// viewer: optional for an acceptance (it reaches the log), the person's to read for another
// document. A failure is said in place and the confirmation stays open.
import { useState } from 'react';

import { Banner, Dialog, Icon, IconTile } from '../../design/components';
import type { IconName } from '../../design/icons';
import { type MessageKey, useT } from '../../i18n';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { useIdentityActions } from './queries';

export type DocumentDecision = 'accept' | 'requestAnother';

const DRAWN: Readonly<
  Record<
    DocumentDecision,
    {
      readonly icon: IconName;
      readonly title: MessageKey;
      readonly confirm: MessageKey;
      readonly effects: readonly (readonly [IconName, MessageKey])[];
    }
  >
> = {
  accept: {
    icon: 'circle-check',
    title: 'admin.dialogs.confirm.acceptDocument.title',
    confirm: 'admin.dialogs.confirm.acceptDocument.confirm',
    effects: [
      ['user-check', 'admin.dialogs.confirm.acceptDocument.effects.active'],
      ['file-text', 'admin.dialogs.confirm.acceptDocument.effects.kept'],
      ['bell', 'admin.dialogs.confirm.acceptDocument.effects.notified'],
    ],
  },
  requestAnother: {
    icon: 'file-text',
    title: 'admin.dialogs.confirm.requestAnotherDocument.title',
    confirm: 'admin.dialogs.confirm.requestAnotherDocument.confirm',
    effects: [
      ['hourglass', 'admin.dialogs.confirm.requestAnotherDocument.effects.pending'],
      ['bell', 'admin.dialogs.confirm.requestAnotherDocument.effects.notified'],
    ],
  },
};

export function DocumentDecisionDialog({
  decision,
  requestId,
  name,
  note,
  onCancel,
  onDone,
}: {
  readonly decision: DocumentDecision;
  readonly requestId: string;
  readonly name: string;
  /** The viewer's note, trimmed; empty when none was written. */
  readonly note: string;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  const t = useT();
  const actions = useIdentityActions();
  const [failed, setFailed] = useState<ErrorMessage | null>(null);
  const drawn = DRAWN[decision];
  const pending = actions.accept.isPending || actions.requestAnother.isPending;

  const confirm = () => {
    setFailed(null);
    const settled = { onSuccess: onDone, onError: (error: unknown) => setFailed(errorMessageKey(error, 'admin.dialogs.submitError')) };
    if (decision === 'accept') {
      actions.accept.mutate({ requestId, ...(note === '' ? {} : { note }) }, settled);
    } else {
      actions.requestAnother.mutate({ requestId, note }, settled);
    }
  };

  return (
    <Dialog
      open
      title={t(drawn.title, { name })}
      leading={<IconTile icon={{ name: drawn.icon }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footerNote')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: pending,
          onPress: onCancel,
        },
        { label: t(drawn.confirm), loading: pending, onPress: confirm },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <ul className="stack gap-2 text-callout">
          {drawn.effects.map(([icon, effect]) => (
            <li key={effect} className="row row--top gap-2">
              <Icon name={icon} size="sm" />
              <span>{t(effect, { name })}</span>
            </li>
          ))}
        </ul>
      </section>
      {failed !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failed.key, failed.values)}
        </Banner>
      ) : null}
    </Dialog>
  );
}
