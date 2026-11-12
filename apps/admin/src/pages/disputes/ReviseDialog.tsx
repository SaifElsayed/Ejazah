// T049 (FR-472; SRS FR-DISPUTE-7; T059's `disputes.revise`): a resolved dispute's ruling revised,
// one dialog with no second step (Q2). The page mounts it only while `disputes.get` answers
// `revisable`, and only while it is open, so the idempotency key is minted when it opens and reused
// on its retry: a lost answer is never a second revision. What a revision does is said before
// anything is sent (the session's outcome only; no suspension or ban lifted, no ended enrollment
// reopened; the remedy at its own time), then the outcome and a mandatory reason. Each refusal T059
// names is said in plain words (`RULING_FINAL` by its cause, `RULING_SUPERSEDED`, `DISPUTE_OPEN`,
// `SESSION_UNDER_REVIEW`, `CONFLICT` for the key reused, `NOT_FOUND`); any other failure,
// `admin.dialogs.submitError`. The answer goes to `onDone`, which says its `notUndone`.
import type { AdminOutcome } from '@ijazah/contracts/admin';
import { useState } from 'react';

import {
  Banner,
  Choice,
  ChoiceGroup,
  Dialog,
  Field,
  Icon,
  IconTile,
  Input,
} from '../../design/components';
import { type MessageKey, useT } from '../../i18n';
import type { ErrorMessage } from '../../lib/error-message';
import { mintIdempotencyKey } from '../_shared/idempotency-key';
import { reviseFailure } from './failures';
import { SESSION_STATUS } from './labels';
import { type RevisionAnswer, useRevise } from './queries';

const OUTCOMES: readonly AdminOutcome[] = [
  'done',
  'student_no_show',
  'teacher_no_show',
  'both_no_show',
];

export function ReviseDialog({
  disputeId,
  onDone,
  onClose,
}: {
  readonly disputeId: string;
  readonly onDone: (answer: RevisionAnswer) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const revise = useRevise(disputeId, idempotencyKey);
  const [outcome, setOutcome] = useState<AdminOutcome | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const input =
    outcome === undefined || reason.trim() === '' ? undefined : { outcome, reason: reason.trim() };
  return (
    <Dialog
      open
      title={t('admin.disputes.revise.title')}
      leading={<IconTile icon={{ name: 'rotate-ccw' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: revise.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.disputes.view.reviseButton'),
          disabled: input === undefined,
          loading: revise.isPending,
          onPress: () => {
            if (input === undefined) return;
            setFailure(undefined);
            revise.mutate(input, {
              onSuccess: onDone,
              onError: (error) => setFailure(reviseFailure(error)),
            });
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.disputes.revise.effect')}</span>
        </p>
      </section>
      <ChoiceGroup legend={t('admin.disputes.revise.outcomeLegend')}>
        {OUTCOMES.map((each) => (
          <Choice
            key={each}
            label={t(SESSION_STATUS[each])}
            selected={outcome === each}
            onPress={() => setOutcome(each)}
          />
        ))}
      </ChoiceGroup>
      <Field label={t('admin.disputes.revise.reasonLabel')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
    </Dialog>
  );
}
