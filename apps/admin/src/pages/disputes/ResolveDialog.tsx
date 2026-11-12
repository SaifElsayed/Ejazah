// T049 (FR-476; research R-308; SRS FR-DISPUTE-3, FR-DISPUTE-6): the ruling on an open dispute, one
// dialog with no second step (Q2), over `disputes.resolve`. R-308's choices: uphold the outcome,
// re-mark the session consumed or not consumed, record an absence against the student or the
// teacher, order compensation, suspend or ban a party; whom a choice names is asked beside it. What
// each choice does is said in plain words before anything is sent: ordering compensation records a
// decision only and moves no money (the board's `compensationNote`), and no remedy is offered by
// the ruling itself (FR-476). The reason is mandatory, as `applications/StandingDialogs.tsx` asks
// for its reason. Each refusal is said in plain words (`CONFLICT` `not_evaluated`, `not_open`, the
// standing move refused, `NOT_FOUND`); any other failure, `admin.dialogs.submitError`. A ruling
// reads the queue and the dispute again and closes the dialog.
import type { DisputeResolution, DisputesResolveInput } from '@ijazah/contracts/admin';
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
import { partyLabel } from '../_shared';
import { resolveFailure } from './failures';
import { ROLE, SESSION_STATUS } from './labels';
import { type DisputeView, useResolve } from './queries';

type Party = 'student' | 'teacher';

/** One choice of the dialog: a resolution, and for a re-marking whether it was consumed. */
interface Option {
  readonly value: string;
  readonly label: MessageKey;
  readonly resolution: DisputeResolution;
  readonly consumed?: boolean;
  readonly danger?: boolean;
}

const OPTIONS: readonly Option[] = [
  { value: 'upheld', label: 'admin.disputes.detail.choices.uphold', resolution: 'upheld' },
  {
    value: 'consumed',
    label: 'admin.disputes.detail.choices.reclassifyConsumed',
    resolution: 're_marked',
    consumed: true,
  },
  {
    value: 'not_consumed',
    label: 'admin.disputes.detail.choices.reclassifyNotConsumed',
    resolution: 're_marked',
    consumed: false,
  },
  {
    value: 'no_show_recorded',
    label: 'admin.disputes.detail.choices.recordNoShow',
    resolution: 'no_show_recorded',
  },
  {
    value: 'compensation_ordered',
    label: 'admin.disputes.detail.choices.orderCompensation',
    resolution: 'compensation_ordered',
  },
  {
    value: 'party_suspended',
    label: 'admin.disputes.detail.suspendParty',
    resolution: 'party_suspended',
    danger: true,
  },
  {
    value: 'party_banned',
    label: 'admin.disputes.detail.banParty',
    resolution: 'party_banned',
    danger: true,
  },
];

const PARTIES: readonly Party[] = ['student', 'teacher'];

export function ResolveDialog({
  view,
  onClose,
}: {
  readonly view: DisputeView;
  readonly onClose: () => void;
}) {
  const t = useT();
  const resolve = useResolve();
  const [option, setOption] = useState<Option | undefined>(undefined);
  const [against, setAgainst] = useState<Party | undefined>(undefined);
  const [party, setParty] = useState<Party | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const { dispute, parties } = view;
  const outcome = t(
    dispute.outcomeUnderDispute === undefined
      ? 'admin.disputes.queue.notEvaluated'
      : SESSION_STATUS[dispute.outcomeUnderDispute],
  );
  const resolution = option?.resolution;
  const standing = resolution === 'party_suspended' || resolution === 'party_banned';
  const input = inputOf(dispute.disputeId, option, against, party, reason);

  return (
    <Dialog
      open
      wide
      title={t('admin.disputes.resolve.title')}
      leading={<IconTile icon={{ name: 'scale' }} tone="primary" />}
      note={t('admin.dialogs.confirm.common.footer')}
      actions={[
        {
          label: t('admin.dialogs.confirm.common.cancel'),
          variant: 'secondary',
          disabled: resolve.isPending,
          onPress: onClose,
        },
        {
          label: t('admin.disputes.detail.issue'),
          variant: standing ? 'danger' : 'primary',
          disabled: input === undefined,
          loading: resolve.isPending,
          onPress: () => {
            if (input === undefined) return;
            setFailure(undefined);
            resolve.mutate(input, {
              onSuccess: onClose,
              onError: (error) => setFailure(resolveFailure(error)),
            });
          },
        },
      ]}
    >
      <ChoiceGroup legend={t('admin.disputes.detail.decisionTitle')}>
        {OPTIONS.map((each) => (
          <Choice
            key={each.value}
            label={t(each.label)}
            selected={option?.value === each.value}
            {...(each.danger === true ? { danger: true } : {})}
            onPress={() => setOption(each)}
          />
        ))}
      </ChoiceGroup>
      {resolution === 'no_show_recorded' ? (
        <ChoiceGroup legend={t('admin.disputes.resolve.againstLegend')}>
          {PARTIES.map((each) => (
            <Choice
              key={each}
              label={t(ROLE[each])}
              selected={against === each}
              onPress={() => setAgainst(each)}
            />
          ))}
        </ChoiceGroup>
      ) : null}
      {standing ? (
        <ChoiceGroup legend={t('admin.disputes.detail.partyTitle')}>
          {PARTIES.map((each) => (
            <Choice
              key={each}
              label={t(
                each === 'student'
                  ? 'admin.disputes.detail.partyStudent'
                  : 'admin.disputes.detail.partyTeacher',
                { name: partyLabel(parties[each], each, t) },
              )}
              selected={party === each}
              onPress={() => setParty(each)}
            />
          ))}
        </ChoiceGroup>
      ) : null}
      {option === undefined ? null : (
        <section className="section">
          <h3 className="group-label">{t('admin.dialogs.confirm.common.effectsTitle')}</h3>
          {effectsOf(option, against).map((effect) => (
            <p key={effect} className="row row--top gap-2 text-callout">
              <Icon name="info" size="sm" />
              <span>{t(effect, { outcome })}</span>
            </p>
          ))}
        </section>
      )}
      <Field label={t('admin.disputes.detail.notesLabel')}>
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

/** The ruling to send once its choice and whom it names and the reason are given; else nothing. */
function inputOf(
  disputeId: string,
  option: Option | undefined,
  against: Party | undefined,
  party: Party | undefined,
  reason: string,
): DisputesResolveInput | undefined {
  const trimmed = reason.trim();
  if (option === undefined || trimmed === '') return undefined;
  const base = { disputeId, reason: trimmed };
  switch (option.resolution) {
    case 'no_show_recorded':
      return against === undefined
        ? undefined
        : { ...base, resolution: option.resolution, against };
    case 'party_suspended':
    case 'party_banned':
      return party === undefined ? undefined : { ...base, resolution: option.resolution, party };
    case 're_marked':
      return { ...base, resolution: option.resolution, consumed: option.consumed === true };
    default:
      return { ...base, resolution: option.resolution };
  }
}

/** What the chosen ruling does, in plain words, then that no remedy comes from the ruling itself. */
function effectsOf(option: Option, against: Party | undefined): readonly MessageKey[] {
  const later: MessageKey = 'admin.disputes.resolve.effect.remedyLater';
  switch (option.resolution) {
    case 'upheld':
      return ['admin.disputes.resolve.effect.keepsOutcome', later];
    case 're_marked':
      return [
        option.consumed === true
          ? 'admin.disputes.detail.choices.reclassifyConsumedHint'
          : 'admin.disputes.detail.choices.reclassifyNotConsumedHint',
        later,
      ];
    case 'no_show_recorded':
      return [
        against === undefined
          ? 'admin.disputes.detail.choices.recordNoShowHint'
          : against === 'teacher'
            ? 'admin.disputes.resolve.effect.teacherNoShow'
            : 'admin.disputes.resolve.effect.studentNoShow',
        later,
      ];
    case 'compensation_ordered':
      return [
        'admin.disputes.detail.compensationNote',
        'admin.disputes.resolve.effect.keepsOutcome',
        later,
      ];
    case 'party_suspended':
      return ['admin.disputes.resolve.effect.suspended', later];
    case 'party_banned':
      return ['admin.disputes.resolve.effect.banned', later];
  }
}
