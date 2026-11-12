// T048 (FR-477; T033's `sessions.review.resolve`): the resolution of a session under review,
// `under_threshold` or `provider_outage`. One dialog, as `applications/StandingDialogs.tsx`: one of
// the four outcomes and a mandatory reason before anything is sent, what follows said as the server
// does it now, and no second step. A session no longer under review (`CONFLICT` `not_under_review`)
// and a missing one (`NOT_FOUND`) are said in plain words; any other failure is the generic
// `admin.dialogs.submitError`. On success the queue and the record are read again and it closes.
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
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { useResolve } from './queries';

const OUTCOMES: readonly { readonly value: AdminOutcome; readonly label: MessageKey }[] = [
  { value: 'done', label: 'admin.status.session.done' },
  { value: 'student_no_show', label: 'admin.status.session.studentNoShow' },
  { value: 'teacher_no_show', label: 'admin.status.session.teacherNoShow' },
  { value: 'both_no_show', label: 'admin.status.session.bothNoShow' },
];

/** The words of a refused resolution, by its code and its `details.cause` (T033). */
function resolveFailure(error: unknown): MessageKey {
  const cause = errorDetailsOf(error).find((each) => each.path === 'cause')?.code;
  switch (errorCodeOf(error)) {
    case 'CONFLICT':
      return cause === 'not_under_review'
        ? 'admin.review.resolve.refused.notUnderReview'
        : 'admin.dialogs.submitError';
    case 'NOT_FOUND':
      return 'admin.review.resolve.refused.notFound';
    default:
      return 'admin.dialogs.submitError';
  }
}

export function ResolveDialog({
  sessionId,
  onClose,
}: {
  readonly sessionId: string;
  /** Cancel, or the resolution written and read again. */
  readonly onClose: () => void;
}) {
  const t = useT();
  const resolve = useResolve();
  const [outcome, setOutcome] = useState<AdminOutcome | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<MessageKey | undefined>(undefined);
  const ready = outcome !== undefined && reason.trim() !== '';
  return (
    <Dialog
      open
      title={t('admin.review.resolve.title')}
      leading={<IconTile icon={{ name: 'circle-check' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: resolve.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.sessionReview.detail.confirm'),
          disabled: !ready,
          loading: resolve.isPending,
          onPress: () => {
            if (outcome === undefined || reason.trim() === '') return;
            setFailure(undefined);
            resolve.mutate(
              { sessionId, outcome, reason: reason.trim() },
              { onSuccess: onClose, onError: (error) => setFailure(resolveFailure(error)) },
            );
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.review.resolve.effect')}</span>
        </p>
      </section>
      <ChoiceGroup legend={t('admin.sessionReview.detail.outcomeTitle')}>
        {OUTCOMES.map((each) => (
          <Choice
            key={each.value}
            label={t(each.label)}
            selected={outcome === each.value}
            onPress={() => setOutcome(each.value)}
          />
        ))}
      </ChoiceGroup>
      <Field label={t('admin.sessionReview.detail.reasonLabel')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure)}
        </Banner>
      )}
    </Dialog>
  );
}
