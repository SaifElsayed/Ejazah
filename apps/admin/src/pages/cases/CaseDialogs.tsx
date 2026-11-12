// T050 (FR-478, FR-486, FR-453; R-313, R-322; admin-surface.md, `cases.resolve`, `cases.dismiss`,
// `cases.decideComplaint`): the case page's two decisions, one dialog each, as
// `applications/StandingDialogs.tsx` draws them: what the server does now said in plain words, a
// mandatory note (the contract's `adminReason`, 1 to 1000 characters, not blank) before the button
// sends, and no second confirmation (the note under T050, Q2).
// - `CloseCaseDialog`: resolve or dismiss a compensation case. A `student_suspended` case says its
//   own two outcomes: resolved, the student cleared and each cancelled session offered its remedy;
//   dismissed, the fault confirmed and the enrollment ended (R-313). Refusals by code and cause.
// - `DecideComplaintDialog`: a complaint of a teacher's absence decided three ways, each with what
//   it does; the answer said in place, with the new case's link when the answer names one.
// Neither says a closing is final (Q1 (a)); neither names an amount (R-MONEY-6).
import {
  adminReason,
  type CaseDetail,
  type CasesDecideComplaintOutput,
  type ComplaintDecision,
} from '@ijazah/contracts/admin';
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
import { closingFailure, DECISION, decisionFailure } from './words';

/** The note's bound, the contract's. */
const NOTE_MAX = adminReason.maxLength ?? Number.POSITIVE_INFINITY;

export type Closing = 'resolve' | 'dismiss';

const CLOSING: Readonly<
  Record<
    Closing,
    {
      readonly title: MessageKey;
      readonly confirm: MessageKey;
      readonly effects: readonly MessageKey[];
      readonly suspended: readonly MessageKey[];
    }
  >
> = {
  resolve: {
    title: 'admin.cases.close.resolve.title',
    confirm: 'admin.cases.action.resolve',
    effects: ['admin.cases.close.resolve.effect'],
    suspended: [
      'admin.cases.close.suspended.resolve.effect',
      'admin.cases.close.suspended.resolve.ended',
      'admin.cases.close.suspended.resolve.reinstate',
    ],
  },
  dismiss: {
    title: 'admin.cases.close.dismiss.title',
    confirm: 'admin.cases.action.dismiss',
    effects: ['admin.cases.close.dismiss.effect'],
    suspended: [
      'admin.cases.close.suspended.dismiss.effect',
      'admin.cases.close.suspended.dismiss.ended',
    ],
  },
};

/** The note field, required and bounded as the contract bounds it. */
function NoteField({
  label,
  note,
  onChange,
  disabled = false,
}: {
  readonly label: MessageKey;
  readonly note: string;
  readonly onChange: (note: string) => void;
  readonly disabled?: boolean;
}) {
  const t = useT();
  const tooLong = note.trim().length > NOTE_MAX;
  return (
    <Field
      label={t(label)}
      hint={t('admin.cases.close.noteHint', { max: NOTE_MAX })}
      {...(tooLong ? { error: t('admin.cases.close.noteTooLong', { max: NOTE_MAX }) } : {})}
    >
      <Input
        value={note}
        onChangeText={onChange}
        multiline
        error={tooLong}
        disabled={disabled}
        placeholder={t('admin.dialogs.confirm.common.reasonPlaceholder')}
      />
    </Field>
  );
}

function Effects({ effects }: { readonly effects: readonly MessageKey[] }) {
  const t = useT();
  return (
    <section className="section">
      <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
      {effects.map((effect) => (
        <p key={effect} className="row row--top gap-2 text-callout">
          <Icon name="info" size="sm" />
          <span>{t(effect)}</span>
        </p>
      ))}
    </section>
  );
}

const noteReady = (note: string) => adminReason.safeParse(note).success;

export interface CloseCaseDialogProps {
  readonly kind: Closing;
  readonly detail: CaseDetail;
  readonly onClose: () => void;
  /** Closed: the page reads again, and the dialog goes. */
  readonly onDone: () => void;
}

export function CloseCaseDialog({ kind, detail, onClose, onDone }: CloseCaseDialogProps) {
  const t = useT();
  const { client } = useAdmin();
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<MessageKey | undefined>(undefined);
  const close = useMutation({
    mutationFn: async (sent: string): Promise<void> => {
      await client.api.cases[kind].mutate({ caseId: detail.caseId, note: sent });
    },
  });
  const drawn = CLOSING[kind];
  const ready = noteReady(note);
  return (
    <Dialog
      open
      title={t(drawn.title)}
      leading={
        <IconTile
          icon={{ name: kind === 'resolve' ? 'circle-check' : 'circle-x' }}
          tone={kind === 'resolve' ? 'primary' : 'danger'}
        />
      }
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: close.isPending,
          onPress: onClose,
        },
        {
          label: t(drawn.confirm),
          variant: kind === 'resolve' ? 'primary' : 'danger',
          disabled: !ready,
          loading: close.isPending,
          onPress: () => {
            if (!ready) return;
            setFailure(undefined);
            close.mutate(note.trim(), {
              onSuccess: onDone,
              onError: (error) => setFailure(closingFailure(error)),
            });
          },
        },
      ]}
    >
      <Effects effects={detail.reason === 'student_suspended' ? drawn.suspended : drawn.effects} />
      <NoteField label="admin.cases.close.noteLabel" note={note} onChange={setNote} />
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure)}
        </Banner>
      )}
    </Dialog>
  );
}

const DECISIONS: readonly ComplaintDecision[] = ['end_enrollment', 'suspend_teacher', 'close'];

export interface DecideComplaintDialogProps {
  readonly caseId: string;
  readonly onClose: () => void;
  /** Decided: the page reads again; the dialog stays to say the answer. */
  readonly onDone: () => void;
}

export function DecideComplaintDialog({ caseId, onClose, onDone }: DecideComplaintDialogProps) {
  const t = useT();
  const navigate = useNavigate();
  const { client } = useAdmin();
  const [decision, setDecision] = useState<ComplaintDecision | undefined>(undefined);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<MessageKey | undefined>(undefined);
  const [answer, setAnswer] = useState<CasesDecideComplaintOutput | undefined>(undefined);
  const decide = useMutation({
    mutationFn: (sent: { readonly decision: ComplaintDecision; readonly note: string }) =>
      client.api.cases.decideComplaint.mutate({ caseId, ...sent }),
  });
  const ready = decision !== undefined && noteReady(note);
  const newCaseHref =
    answer?.newCaseId === undefined ? undefined : `/cases?case=${answer.newCaseId}`;
  return (
    <Dialog
      open
      title={t('admin.cases.decide.title')}
      leading={<IconTile icon={{ name: 'scale' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={
        answer === undefined
          ? [
              {
                label: t('admin.dialogs.confirm.common.cancel'),
                variant: 'secondary',
                disabled: decide.isPending,
                onPress: onClose,
              },
              {
                label: t('admin.common.action.issueDecision'),
                disabled: !ready,
                loading: decide.isPending,
                onPress: () => {
                  if (decision === undefined || !noteReady(note)) return;
                  setFailure(undefined);
                  decide.mutate(
                    { decision, note: note.trim() },
                    {
                      onSuccess: (decided) => {
                        setAnswer(decided);
                        onDone();
                      },
                      onError: (error) => setFailure(decisionFailure(error)),
                    },
                  );
                },
              },
            ]
          : [{ label: t('admin.cases.decide.closeDialog'), variant: 'secondary', onPress: onClose }]
      }
    >
      <section className="section">
        <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
        {DECISIONS.map((each) => (
          <p key={each} className="row row--top gap-2 text-callout">
            <Icon name="info" size="sm" />
            <span className="stack gap-half">
              <strong>{t(DECISION[each].label)}</strong>
              <span>{t(DECISION[each].effect)}</span>
            </span>
          </p>
        ))}
      </section>
      <ChoiceGroup legend={t('admin.cases.decide.legend')}>
        {DECISIONS.map((each) => (
          <Choice
            key={each}
            label={t(DECISION[each].label)}
            selected={decision === each}
            danger={each !== 'close'}
            onPress={() => {
              if (answer === undefined) setDecision(each);
            }}
          />
        ))}
      </ChoiceGroup>
      <NoteField
        label="admin.cases.decide.noteLabel"
        note={note}
        onChange={setNote}
        disabled={answer !== undefined}
      />
      {failure === undefined ? null : (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t(failure)}
        </Banner>
      )}
      {answer === undefined ? null : (
        <Banner icon={{ name: 'circle-check' }} tone="success">
          <span className="stack gap-2">
            <span>{t('admin.cases.decide.done')}</span>
            {newCaseHref === undefined ? null : (
              <>
                <span>{t('admin.cases.decide.newCase')}</span>
                <span className="self-start">
                  <TextLink
                    label={t('admin.cases.decide.viewNewCase')}
                    href={newCaseHref}
                    onPress={() => {
                      onClose();
                      void navigate(newCaseHref);
                    }}
                  />
                </span>
              </>
            )}
          </span>
        </Banner>
      )}
    </Dialog>
  );
}
