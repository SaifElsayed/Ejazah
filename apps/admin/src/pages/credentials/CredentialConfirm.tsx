// T072 (FR-163, FR-164): the confirmations of the credentials' four decisions (screens.md §24:
// `approveCredential`, `requestCredentialDocument`, `rejectCredential`, `saveCredentialCorrection`),
// each with what truly follows (B14c, the owner's decision: no notification is promised, since none
// is sent, and an applicant's subject is added only when the application is approved). The
// rejection's reason, which the teacher reads, is written here; the others' text was written in the
// panel. The approval takes an optional note for the log. A credential that moved meanwhile, or a
// subject the teacher already holds, is said in place, and the panel reads it again.
import { useState } from 'react';

import { Banner, Dialog, Field, Icon, IconTile, Input } from '../../design/components';
import type { IconName } from '../../design/icons';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type CredentialDetail, useCredentialActions } from './queries';

/** What the panel sends once confirmed: the transcription, the request, the correction. */
export type CredentialDecision =
  | {
      readonly kind: 'approve';
      readonly transcription: {
        readonly holderName: string;
        readonly riwaya: string;
        readonly tariq?: string;
        readonly chain: readonly { readonly names: readonly string[] }[];
      };
    }
  | { readonly kind: 'requestDocument'; readonly reason: string }
  | { readonly kind: 'reject' }
  | {
      readonly kind: 'correct';
      readonly changes: {
        readonly holderName?: string;
        readonly riwaya?: string;
        readonly tariq?: string;
        readonly chain?: readonly { readonly names: readonly string[] }[];
      };
      readonly reason: string;
    };

const DRAWN: Readonly<
  Record<
    CredentialDecision['kind'],
    {
      readonly icon: IconName;
      readonly title: MessageKey;
      readonly confirm: MessageKey;
      readonly danger?: true;
    }
  >
> = {
  approve: {
    icon: 'award',
    title: 'admin.dialogs.confirm.approveCredential.title',
    confirm: 'admin.dialogs.confirm.approveCredential.confirm',
  },
  requestDocument: {
    icon: 'file-text',
    title: 'admin.dialogs.confirm.requestCredentialDocument.title',
    confirm: 'admin.dialogs.confirm.requestCredentialDocument.confirm',
  },
  reject: {
    icon: 'circle-x',
    title: 'admin.dialogs.confirm.rejectCredential.title',
    confirm: 'admin.dialogs.confirm.rejectCredential.confirm',
    danger: true,
  },
  correct: {
    icon: 'pen-line',
    title: 'admin.dialogs.confirm.saveCredentialCorrection.title',
    confirm: 'admin.dialogs.confirm.saveCredentialCorrection.confirm',
  },
};

/** What each decision does, as the server does it. */
function effectsOf(
  decision: CredentialDecision,
  detail: CredentialDetail,
): readonly (readonly [IconName, MessageKey])[] {
  switch (decision.kind) {
    case 'approve':
      return [
        ['award', 'admin.dialogs.confirm.approveCredential.effects.verified'],
        detail.origin === 'added'
          ? ['user-check', 'admin.dialogs.confirm.approveCredential.effects.subjectAdded']
          : ['hourglass', 'admin.dialogs.confirm.approveCredential.effects.withApplication'],
      ];
    case 'requestDocument':
      return [
        ['file-text', 'admin.dialogs.confirm.requestCredentialDocument.effects.status'],
        ['smartphone', 'admin.dialogs.confirm.requestCredentialDocument.effects.inApp'],
        ['shield-check', 'admin.dialogs.confirm.requestCredentialDocument.effects.unchanged'],
      ];
    case 'reject':
      return [
        ['circle-x', 'admin.dialogs.confirm.rejectCredential.effects.rejected'],
        ['smartphone', 'admin.dialogs.confirm.rejectCredential.effects.reasonShown'],
        ['upload', 'admin.dialogs.confirm.rejectCredential.effects.reapply'],
      ];
    case 'correct':
      return [
        ['user', 'admin.dialogs.confirm.saveCredentialCorrection.effects.applied'],
        ['award', 'admin.dialogs.confirm.saveCredentialCorrection.effects.issuedKept'],
        ['file-text', 'admin.dialogs.confirm.saveCredentialCorrection.effects.logged'],
      ];
  }
}

export function CredentialConfirm({
  decision,
  detail,
  onClose,
  onDone,
  onMoved,
}: {
  readonly decision: CredentialDecision;
  readonly detail: CredentialDetail;
  readonly onClose: () => void;
  /** After the decision is saved, before the dialog closes. */
  readonly onDone: () => void;
  /** The credential moved meanwhile: the panel says so, since reading it again draws it anew. */
  readonly onMoved: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const actions = useCredentialActions();
  const [written, setWritten] = useState('');
  const [refused, setRefused] = useState<MessageKey | null>(null);
  const drawn = DRAWN[decision.kind];
  const teacher = detail.teacher.displayName;
  const names = {
    teacher,
    subject: locale === 'ar' ? detail.subject.nameAr : detail.subject.nameEn,
  };
  const pending =
    actions.approve.isPending ||
    actions.reject.isPending ||
    actions.requestDocument.isPending ||
    actions.correct.isPending;
  const reasonMissing = decision.kind === 'reject' && written.trim() === '';

  const settled = {
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (error: unknown) => {
      if (errorCodeOf(error) !== 'CONFLICT') {
        setRefused('admin.dialogs.submitError');
      } else if (errorDetailsOf(error).some(({ code }) => code === 'subject_approved')) {
        setRefused('admin.credentials.panel.subjectApproved');
      } else {
        // Its status changed: the panel is drawn anew from the next read and says why (B14c
        // review, round 1, finding 1).
        onMoved();
        onClose();
        void actions.reread();
      }
    },
  };
  const confirm = () => {
    setRefused(null);
    const credentialId = detail.credentialId;
    const note = written.trim();
    switch (decision.kind) {
      case 'approve':
        actions.approve.mutate(
          {
            credentialId,
            ...decision.transcription,
            chain: decision.transcription.chain.map(({ names: generation }) => ({
              names: [...generation],
            })),
            ...(note === '' ? {} : { note }),
          },
          settled,
        );
        return;
      case 'requestDocument':
        actions.requestDocument.mutate({ credentialId, reason: decision.reason }, settled);
        return;
      case 'reject':
        actions.reject.mutate({ credentialId, reason: note }, settled);
        return;
      case 'correct': {
        const { chain, ...fields } = decision.changes;
        actions.correct.mutate(
          {
            credentialId,
            ...fields,
            ...(chain === undefined
              ? {}
              : { chain: chain.map(({ names: generation }) => ({ names: [...generation] })) }),
            reason: decision.reason,
          },
          settled,
        );
      }
    }
  };

  return (
    <Dialog
      open
      title={t(drawn.title, names)}
      leading={
        <IconTile icon={{ name: drawn.icon }} tone={drawn.danger === true ? 'danger' : 'primary'} />
      }
      note={t('admin.dialogs.confirm.common.footerNote')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: pending,
          onPress: onClose,
        },
        {
          label: t(drawn.confirm),
          ...(drawn.danger === true ? { variant: 'danger' as const } : {}),
          disabled: reasonMissing,
          loading: pending,
          onPress: confirm,
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <ul className="stack gap-2 text-callout">
          {effectsOf(decision, detail).map(([icon, effect]) => (
            <li key={effect} className="row row--top gap-2">
              <Icon name={icon} size="sm" />
              <span>{t(effect, names)}</span>
            </li>
          ))}
        </ul>
      </section>
      {decision.kind === 'reject' ? (
        <Field label={t('admin.dialogs.confirm.rejectCredential.reasonLabel')}>
          <Input
            value={written}
            onChangeText={setWritten}
            multiline
            placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
          />
        </Field>
      ) : decision.kind === 'approve' ? (
        <Field
          label={t('admin.dialogs.confirm.common.noteLabel')}
          hint={t('admin.dialogs.confirm.common.noteHint')}
        >
          <Input value={written} onChangeText={setWritten} multiline />
        </Field>
      ) : null}
      {refused === null ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(refused)}
        </Banner>
      )}
    </Dialog>
  );
}
