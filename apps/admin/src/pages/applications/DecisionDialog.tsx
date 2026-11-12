// T071 (FR-162): the decision on an application (`AdminDecisionDialog`, screens.md §24). Three kinds
// switched in place: reject, ask for information, ban; each with its reasons as radio cards, the
// mandatory note the applicant reads, its banner, and the line on the audit log. «طلب معلومات» asks
// for one thing, as the board draws it, sent as the contract's one-item list (owner's decision at
// B14b's check). A failure is said in the dialog, which stays open; a decision closes it. Another
// ijazah is not asked for here but on its credential (`credentials.requestDocument`), which gives
// the applicant the field to send it (T155).
import { useState } from 'react';

import {
  Avatar,
  Banner,
  Choice,
  ChoiceGroup,
  Dialog,
  Field,
  Input,
  Segmented,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import type { Allowed } from './decisions';
import { initialsOf } from './initials';
import { type ApplicationDetail, useApplicationActions } from './queries';

export type DecisionKind = 'reject' | 'requestInfo' | 'ban';

interface KindText {
  readonly legend: MessageKey;
  readonly noteLabel: MessageKey;
  readonly banner: MessageKey;
  readonly bannerIcon: 'rotate-ccw' | 'hourglass' | 'ban';
  readonly bannerTone: 'info' | 'danger';
  readonly confirm: MessageKey;
  readonly footer: MessageKey;
  /** The reasons, by the contract's value. */
  readonly reasons: readonly (readonly [string, MessageKey])[];
}

const KINDS: Readonly<Record<DecisionKind, KindText>> = {
  reject: {
    legend: 'admin.dialogs.decision.reasonLabel',
    noteLabel: 'admin.dialogs.decision.noteLabel',
    banner: 'admin.dialogs.decision.reapplyHint',
    bannerIcon: 'rotate-ccw',
    bannerTone: 'info',
    confirm: 'admin.dialogs.decision.confirmReject',
    footer: 'admin.dialogs.decision.footer',
    reasons: [
      ['name_mismatch', 'admin.dialogs.decision.reasons.nameMismatch'],
      ['qualification_gap', 'admin.dialogs.decision.reasons.qualificationGap'],
      ['call_unsuitable', 'admin.dialogs.decision.reasons.callUnsuitable'],
      ['other', 'admin.dialogs.decision.reasons.other'],
    ],
  },
  requestInfo: {
    legend: 'admin.dialogs.decision.requestInfo.legend',
    noteLabel: 'admin.dialogs.decision.requestInfo.noteLabel',
    banner: 'admin.dialogs.decision.requestInfo.banner',
    bannerIcon: 'hourglass',
    bannerTone: 'info',
    confirm: 'admin.dialogs.decision.requestInfo.confirm',
    footer: 'admin.dialogs.decision.requestInfo.footer',
    reasons: [
      ['id_unclear', 'admin.dialogs.decision.requestInfo.reasons.idUnclear'],
      ['name_mismatch', 'admin.dialogs.decision.requestInfo.reasons.nameMismatch'],
      ['other', 'admin.dialogs.decision.requestInfo.reasons.other'],
    ],
  },
  ban: {
    legend: 'admin.dialogs.decision.ban.legend',
    noteLabel: 'admin.dialogs.decision.ban.noteLabel',
    banner: 'admin.dialogs.decision.ban.banner',
    bannerIcon: 'ban',
    bannerTone: 'danger',
    confirm: 'admin.dialogs.decision.ban.confirm',
    footer: 'admin.dialogs.decision.footer',
    reasons: [
      ['forged_documents', 'admin.dialogs.decision.ban.reasons.forgedDocuments'],
      ['impersonation', 'admin.dialogs.decision.ban.reasons.impersonation'],
      ['call_fraud', 'admin.dialogs.decision.ban.reasons.callFraud'],
      ['other', 'admin.dialogs.decision.ban.reasons.other'],
    ],
  },
};

/** Each decision's reasons by the contract's value, as its dialog names them (the audit log reads them). */
export const DECISION_REASONS: Readonly<Record<DecisionKind, ReadonlyMap<string, MessageKey>>> = {
  reject: new Map(KINDS.reject.reasons),
  requestInfo: new Map(KINDS.requestInfo.reasons),
  ban: new Map(KINDS.ban.reasons),
};

export function DecisionDialog({
  detail,
  initial,
  allowed,
  onClose,
}: {
  readonly detail: ApplicationDetail;
  readonly initial: DecisionKind;
  readonly allowed: Allowed;
  readonly onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const actions = useApplicationActions();
  const [kind, setKind] = useState<DecisionKind>(initial);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<ErrorMessage | null>(null);
  const text = KINDS[kind];
  const kinds = (['reject', 'requestInfo', 'ban'] as const).filter(
    (candidate) => allowed[candidate],
  );
  const pending =
    actions.reject.isPending || actions.requestInfo.isPending || actions.ban.isPending;

  const decide = () => {
    if (reason === null) return;
    setFailed(null);
    const teacherUserId = detail.teacherUserId;
    const settled = { onSuccess: onClose, onError: (error: unknown) => setFailed(errorMessageKey(error, 'admin.dialogs.submitError')) };
    const written = note.trim();
    switch (kind) {
      case 'reject':
        actions.reject.mutate(
          { teacherUserId, reasonChoice: reason as never, note: written },
          settled,
        );
        return;
      case 'requestInfo':
        actions.requestInfo.mutate(
          { teacherUserId, needed: [reason as never], note: written },
          settled,
        );
        return;
      case 'ban':
        actions.ban.mutate(
          { teacherUserId, reasonChoice: reason as never, note: written },
          settled,
        );
    }
  };

  const subjects = detail.subjects
    .map((subject) => (locale === 'ar' ? subject.nameAr : subject.nameEn))
    .join(locale === 'ar' ? '، ' : ', ');

  return (
    <Dialog
      open
      title={t('admin.dialogs.decision.title', { name: detail.displayName })}
      subtitle={t('admin.dialogs.decision.subtitle', {
        subjects,
        date: dayMonthYear(detail.submittedAt, locale, panelTimeZone()),
      })}
      leading={<Avatar initials={initialsOf(detail.displayName)} />}
      note={t(text.footer)}
      actions={[
        {
          label: t('admin.dialogs.decision.cancel'),
          variant: 'secondary',
          disabled: pending,
          onPress: onClose,
        },
        {
          label: t(text.confirm),
          variant: kind === 'requestInfo' ? 'primary' : 'danger',
          disabled: reason === null || note.trim() === '',
          loading: pending,
          onPress: decide,
        },
      ]}
    >
      <Segmented
        accessibilityLabel={t('admin.dialogs.decision.a11yKind')}
        value={kind}
        onChange={(value) => {
          setKind(value as DecisionKind);
          setReason(null);
          setFailed(null);
        }}
        options={kinds.map((candidate) => ({
          value: candidate,
          label: t(`admin.dialogs.decision.kinds.${candidate}`),
          ...(candidate === 'ban' ? { icon: { name: 'ban' as const } } : {}),
        }))}
      />
      <ChoiceGroup legend={t(text.legend)}>
        {text.reasons.map(([value, label]) => (
          <Choice
            key={value}
            label={t(label)}
            selected={reason === value}
            danger={kind !== 'requestInfo'}
            onPress={() => setReason(value)}
          />
        ))}
      </ChoiceGroup>
      <Field label={t(text.noteLabel)} hint={t('admin.dialogs.decision.noteHint')}>
        <Input value={note} onChangeText={setNote} multiline />
      </Field>
      <Banner icon={{ name: text.bannerIcon }} tone={text.bannerTone}>
        {t(text.banner)}
      </Banner>
      {failed !== null ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failed.key, failed.values)}
        </Banner>
      ) : null}
    </Dialog>
  );
}
