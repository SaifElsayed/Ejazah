// B42 lane S (T047, T050; spec FR-493, FR-471 (c); research R-326): an administrator's manual
// compensation case, over T064's `cases.openManual`. The page mounts it: on an enrollment of
// `/sessions` (pre-filled), beside an open remedy there (with its `remedyId`), and on `/cases`'
// queue (the enrollment entered, a uuid) or a case's page (pre-filled). One dialog: the party, the
// student only with a remedy (a remedy is owed to the student; the input schema refuses a teacher),
// and a mandatory reason of 1 to 500 characters, not blank, as the contract bounds it. The
// idempotency key is minted when the dialog opens and reused on its retry, so a lost answer opens
// no second case. The answer is said as the server gave it, a case opened or an open one joined,
// with the case's link; `REMEDY_NOT_OPEN`, `NOT_FOUND`, `RATE_LIMITED` and `CONFLICT` in plain
// words, and any other failure the generic `admin.dialogs.submitError`. `onDone` hands the answer
// to the page, which reads again what it shows.
// 006:T021 (B-P4's conflict check, Q-8 (b), the owner, 2026-11-25): an optional student preset (the
// programme's page, for an assessment never held) fixes the party to the student and locks it, as a
// remedy does, with its own line; it sends no remedy.
import { casesOpenManualInput, type CasesOpenManualOutput } from '@ijazah/contracts/admin';
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
import { errorCodeOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey, retryAfterSecondsOf } from '../../lib/error-message';
import { mintIdempotencyKey } from './idempotency-key';

type Party = CasesOpenManualOutput['party'];

const { enrollmentId: ENROLLMENT_ID, reason: REASON } = casesOpenManualInput.shape;
/** The reason's bound, the contract's (R-326). */
const REASON_MAX = REASON.maxLength ?? Number.POSITIVE_INFINITY;

const REFUSALS: Readonly<Record<string, MessageKey>> = {
  REMEDY_NOT_OPEN: 'admin.shared.manualCase.refused.remedyNotOpen',
  NOT_FOUND: 'admin.shared.manualCase.refused.notFound',
  RATE_LIMITED: 'admin.shared.manualCase.refused.rateLimited',
  CONFLICT: 'admin.shared.keyReused',
};

/**
 * The words of a refused opening, by its code (T064); `RATE_LIMITED` says when to try again when the
 * server gives the time (T058), else keeps its own words; any other failure the generic words.
 */
export function manualCaseFailure(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  if (code === 'RATE_LIMITED' && retryAfterSecondsOf(error) !== undefined) {
    return errorMessageKey(error, 'admin.dialogs.submitError');
  }
  const named = code === undefined ? undefined : REFUSALS[code];
  return named === undefined ? errorMessageKey(error, 'admin.dialogs.submitError') : { key: named };
}

export interface ManualCaseDialogProps {
  /** The enrollment, when the page has one; otherwise the administrator enters it. */
  readonly enrollmentId?: string;
  /** An open remedy to hand to the student's case; the party is then the student. */
  readonly remedyId?: string;
  /** 006:T021 (Q-8 (b)): the party fixed to the student and locked, with no remedy. */
  readonly party?: 'student';
  /** The server's answer, once the case is opened or joined: the page reads again. */
  readonly onDone?: (answer: CasesOpenManualOutput) => void;
  /** Cancel, close after the answer, or the case's link followed. */
  readonly onClose: () => void;
}

export function ManualCaseDialog({
  enrollmentId: given,
  remedyId,
  party: preset,
  onDone,
  onClose,
}: ManualCaseDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const { client } = useAdmin();
  const [idempotencyKey] = useState(mintIdempotencyKey);
  const [entered, setEntered] = useState('');
  const [enrollmentInvalid, setEnrollmentInvalid] = useState(false);
  // A remedy or the preset fixes the party to the student; otherwise the administrator picks it.
  const locked = remedyId !== undefined || preset !== undefined;
  const [party, setParty] = useState<Party | undefined>(locked ? 'student' : undefined);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const [answer, setAnswer] = useState<CasesOpenManualOutput | undefined>(undefined);
  const openManual = useMutation({
    mutationFn: (input: {
      readonly enrollmentId: string;
      readonly party: Party;
      readonly reason: string;
    }) =>
      client.api.cases.openManual.mutate({
        ...input,
        idempotencyKey,
        ...(remedyId === undefined ? {} : { remedyId }),
      }),
  });
  const trimmed = reason.trim();
  const tooLong = trimmed.length > REASON_MAX;
  const ready = party !== undefined && trimmed !== '' && !tooLong;
  const caseHref = answer === undefined ? undefined : `/cases?case=${answer.caseId}`;

  const send = () => {
    if (party === undefined || !REASON.safeParse(reason).success) return;
    const enrollmentId = given ?? entered.trim();
    if (!ENROLLMENT_ID.safeParse(enrollmentId).success) {
      setEnrollmentInvalid(true);
      return;
    }
    setEnrollmentInvalid(false);
    setFailure(undefined);
    openManual.mutate(
      { enrollmentId, party, reason: trimmed },
      {
        onSuccess: (opened) => {
          setAnswer(opened);
          onDone?.(opened);
        },
        onError: (error) => setFailure(manualCaseFailure(error)),
      },
    );
  };

  return (
    <Dialog
      open
      title={t('admin.shared.manualCase.title')}
      leading={<IconTile icon={{ name: 'scale' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={
        answer === undefined
          ? [
              {
                label: t('admin.dialogs.confirm.common.cancel'),
                variant: 'secondary',
                disabled: openManual.isPending,
                onPress: onClose,
              },
              {
                label: t('admin.shared.manualCase.confirm'),
                disabled: !ready,
                loading: openManual.isPending,
                onPress: send,
              },
            ]
          : [{ label: t('admin.shared.manualCase.close'), variant: 'secondary', onPress: onClose }]
      }
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        <p className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t('admin.shared.manualCase.effect')}</span>
        </p>
        {remedyId === undefined ? null : (
          <p className="row row--top gap-2 text-callout">
            <Icon name="info" size="sm" />
            <span>{t('admin.shared.manualCase.effectRemedy')}</span>
          </p>
        )}
      </section>
      {given === undefined ? (
        <Field
          label={t('admin.shared.manualCase.enrollmentLabel')}
          {...(enrollmentInvalid ? { error: t('admin.shared.manualCase.enrollmentInvalid') } : {})}
        >
          <Input
            value={entered}
            onChangeText={(value) => {
              setEntered(value);
              setEnrollmentInvalid(false);
            }}
            ltr
            error={enrollmentInvalid}
            disabled={answer !== undefined}
          />
        </Field>
      ) : null}
      {!locked ? (
        <ChoiceGroup legend={t('admin.shared.manualCase.partyLegend')}>
          <Choice
            label={t('admin.shared.manualCase.partyStudent')}
            selected={party === 'student'}
            onPress={() => setParty('student')}
          />
          <Choice
            label={t('admin.shared.manualCase.partyTeacher')}
            selected={party === 'teacher'}
            onPress={() => setParty('teacher')}
          />
        </ChoiceGroup>
      ) : (
        <p className="text-callout">
          {t(
            remedyId === undefined
              ? 'admin.shared.manualCase.studentParty'
              : 'admin.shared.manualCase.remedyParty',
          )}
        </p>
      )}
      <Field
        label={t('admin.shared.manualCase.reasonLabel')}
        hint={t('admin.shared.manualCase.reasonHint', { max: REASON_MAX })}
        {...(tooLong
          ? { error: t('admin.shared.manualCase.reasonTooLong', { max: REASON_MAX }) }
          : {})}
      >
        <Input
          value={reason}
          onChangeText={setReason}
          multiline
          error={tooLong}
          disabled={answer !== undefined}
          placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
        />
      </Field>
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure.key, failure.values)}
        </Banner>
      )}
      {answer === undefined || caseHref === undefined ? null : (
        <Banner icon={{ name: 'circle-check' }} tone="success">
          <span className="stack gap-2">
            <span>
              {t(
                answer.joined ? 'admin.shared.manualCase.joined' : 'admin.shared.manualCase.opened',
              )}
            </span>
            <span className="self-start">
              <TextLink
                label={t('admin.shared.manualCase.viewCase')}
                href={caseHref}
                onPress={() => {
                  onClose();
                  void navigate(caseHref);
                }}
              />
            </span>
          </span>
        </Banner>
      )}
    </Dialog>
  );
}
