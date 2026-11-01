// T084 (FR-140, ADR 0015 D1): the frame both deletion screens draw (DeleteAccount and
// DeleteAccountTeacher): the nav header, the warning banner, «ما يُحذف» with its x marks and «ما
// يبقى» with its checks, the typed word with its hint, then the danger button, disabled until the
// word is either language's, and «إلغاء». The danger button opens the role's last confirmation
// (`sheet`) with the word the contract takes. Each role passes its own copy, so the student and the
// teacher trees never share a sentence by accident.
import type { MeOutput } from '@ijazah/contracts';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  Field,
  Icon,
  Input,
  NavHeader,
  Section,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useMe } from '../../../../lib/account';
import { AccountLoading } from '../../account';
import { StackScreen } from '../../screen';
import { NotLoaded } from '../../states';
import { confirmationOf, type DeletionConfirmation } from '../api';

export interface DeletionCopy {
  readonly title: string;
  readonly warning: string;
  readonly deletedTitle: string;
  readonly deleted: readonly string[];
  readonly keptTitle: string;
  readonly kept: readonly string[];
  readonly confirmLabel: string;
  readonly confirmHint: string;
  readonly submit: string;
  readonly cancel: string;
}

export function DeletionScreen({
  copy,
  onLeave,
  sheet,
}: {
  readonly copy: DeletionCopy;
  /** Back and «إلغاء»: where the role's account tab is. */
  readonly onLeave: () => void;
  /** The role's last confirmation, open once the word is typed and the button pressed. */
  readonly sheet: (props: {
    readonly confirmation: DeletionConfirmation;
    readonly me: MeOutput;
    readonly onClose: () => void;
  }) => ReactNode;
}) {
  const me = useMe();
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState<DeletionConfirmation | null>(null);
  const confirmation = confirmationOf(typed);
  const account = me.data;
  return (
    <StackScreen
      header={<NavHeader title={copy.title} back={{ kind: 'back', onPress: onLeave }} />}
      footer={
        <ActionBar>
          <Button
            label={copy.submit}
            variant="danger"
            icon={{ name: 'trash' }}
            layout="block"
            disabled={confirmation === null || account === undefined}
            onPress={() => setConfirming(confirmation)}
          />
          <Button label={copy.cancel} variant="ghost" layout="block" onPress={onLeave} />
        </ActionBar>
      }
    >
      {account === undefined ? (
        <NotLoaded
          failed={me.isError}
          onRetry={() => void me.refetch()}
          loading={<AccountLoading />}
        />
      ) : (
        <>
          <Banner icon={{ name: 'triangle-alert' }} tone="warning">
            {copy.warning}
          </Banner>
          <Section title={copy.deletedTitle}>
            <Lines icon="x" tone="danger" lines={copy.deleted} />
          </Section>
          <Section title={copy.keptTitle}>
            <Lines icon="check" tone="success" lines={copy.kept} />
          </Section>
          <Field label={copy.confirmLabel} hint={copy.confirmHint}>
            <Input value={typed} onChangeText={setTyped} />
          </Field>
          {confirming === null
            ? null
            : sheet({ confirmation: confirming, me: account, onClose: () => setConfirming(null) })}
        </>
      )}
    </StackScreen>
  );
}

function Lines({
  icon,
  tone,
  lines,
}: {
  readonly icon: 'x' | 'check';
  readonly tone: 'danger' | 'success';
  readonly lines: readonly string[];
}) {
  return (
    <View style={{ gap: tokens.space['2'] }}>
      {lines.map((line) => (
        <View
          key={line}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space['2'] }}
        >
          <Icon name={icon} size="sm" stroke="medium" tone={tone} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="callout">{line}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
