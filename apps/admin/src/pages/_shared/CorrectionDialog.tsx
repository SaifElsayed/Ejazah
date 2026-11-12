// B42 lane S (T047, T048; spec FR-439; research R-323 GAP-3): the correction of an outcome nobody
// disputed, over T059's `sessions.review.revise`. The page decides when to offer it (`correctable`
// on `/sessions`, a settled `done` or no-show on `/review`'s telemetry) and mounts this dialog only
// while it is open; the server decides whether it is admitted. One dialog: the outcome and a
// mandatory reason, as `applications/StandingDialogs.tsx` asks for its reason, and no second step.
// The idempotency key is minted when the dialog opens and reused on its retry, so a lost answer is
// never a second correction. Each refusal T059 names is said in plain words (`RULING_FINAL` by its
// cause, `DISPUTE_OPEN`, `CONFLICT` by its cause with the ruled dispute's link, the key reused,
// `SESSION_UNDER_REVIEW`, `NOT_FOUND`); any other failure is the generic `admin.dialogs.submitError`.
// The answer goes to `onDone`, and the page reads again what it shows.
import type { AdminOutcome, SessionsReviewReviseOutput } from '@ijazah/contracts/admin';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  Banner,
  Choice,
  ChoiceGroup,
  Dialog,
  Field,
  Icon,
  IconTile,
  Input,
  TextLink,
} from '../../design/components';
import { type MessageKey, useT } from '../../i18n';
import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { mintIdempotencyKey } from './idempotency-key';

const OUTCOMES: readonly { readonly value: AdminOutcome; readonly label: MessageKey }[] = [
  { value: 'done', label: 'admin.status.session.done' },
  { value: 'student_no_show', label: 'admin.status.session.studentNoShow' },
  { value: 'teacher_no_show', label: 'admin.status.session.teacherNoShow' },
  { value: 'both_no_show', label: 'admin.status.session.bothNoShow' },
];

/** What a failed correction says, and the ruled dispute's link when the refusal names one. */
interface Failure {
  readonly words: MessageKey;
  readonly disputeId?: string;
}

/** The words of a refused correction, by its code and its `details.cause` (T059). */
export function correctionFailure(error: unknown): Failure {
  const details = errorDetailsOf(error);
  const detail = (path: string) => details.find((each) => each.path === path)?.code;
  const cause = detail('cause');
  switch (errorCodeOf(error)) {
    case 'RULING_FINAL':
      if (cause === 'window_closed')
        return { words: 'admin.shared.correction.refused.windowClosed' };
      if (cause === 'remedy_offered') {
        return { words: 'admin.shared.correction.refused.remedyOffered' };
      }
      return { words: 'admin.shared.correction.refused.final' };
    case 'DISPUTE_OPEN':
      return { words: 'admin.shared.correction.refused.disputeOpen' };
    case 'CONFLICT': {
      if (cause === 'not_settled') return { words: 'admin.shared.correction.refused.notSettled' };
      if (cause !== 'ruled') return { words: 'admin.shared.keyReused' };
      const disputeId = detail('disputeId');
      return {
        words: 'admin.shared.correction.refused.ruled',
        ...(disputeId === undefined ? {} : { disputeId }),
      };
    }
    case 'SESSION_UNDER_REVIEW':
      return { words: 'admin.shared.correction.refused.underReview' };
    case 'NOT_FOUND':
      return { words: 'admin.shared.correction.refused.notFound' };
    default:
      return { words: 'admin.dialogs.submitError' };
  }
}

export interface CorrectionDialogProps {
  /** The session whose settled outcome is corrected. */
  readonly sessionId: string;
  /** The server's answer, once the correction is written: the page reads again and closes. */
  readonly onDone: (answer: SessionsReviewReviseOutput) => void;
  /** Cancel, or a link followed out of the dialog. */
  readonly onClose: () => void;
}

export function CorrectionDialog({ sessionId, onDone, onClose }: CorrectionDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const { client } = useAdmin();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [outcome, setOutcome] = useState<AdminOutcome | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const revise = useMutation({
    mutationFn: (input: { readonly outcome: AdminOutcome; readonly reason: string }) =>
      client.api.sessions.review.revise.mutate({ sessionId, idempotencyKey, ...input }),
  });
  const ready = outcome !== undefined && reason.trim() !== '';
  const disputeHref =
    failure?.disputeId === undefined ? undefined : `/disputes?dispute=${failure.disputeId}`;
  return (
    <Dialog
      open
      title={t('admin.shared.correction.title')}
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
          label: t('admin.shared.correction.confirm'),
          disabled: !ready,
          loading: revise.isPending,
          onPress: () => {
            if (outcome === undefined || reason.trim() === '') return;
            setFailure(undefined);
            revise.mutate(
              { outcome, reason: reason.trim() },
              {
                onSuccess: (answer) => onDone(answer),
                onError: (error) => setFailure(correctionFailure(error)),
              },
            );
          },
        },
      ]}
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.shared.correction.effect')}</span>
        </p>
      </section>
      <ChoiceGroup legend={t('admin.shared.correction.outcomeLegend')}>
        {OUTCOMES.map((each) => (
          <Choice
            key={each.value}
            label={t(each.label)}
            selected={outcome === each.value}
            onPress={() => setOutcome(each.value)}
          />
        ))}
      </ChoiceGroup>
      <Field label={t('admin.shared.correction.reasonLabel')}>
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          <span className="stack gap-2">
            <span>{t(failure.words)}</span>
            {disputeHref === undefined ? null : (
              <span className="self-start">
                <TextLink
                  label={t('admin.shared.correction.refused.openDispute')}
                  href={disputeHref}
                  onPress={() => {
                    onClose();
                    void navigate(disputeHref);
                  }}
                />
              </span>
            )}
          </span>
        </Banner>
      )}
    </Dialog>
  );
}
