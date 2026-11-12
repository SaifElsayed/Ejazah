// T043 of specs/004-sessions (FR-465; H2, H4; contracts/app-surface.md, "`sessions.remedy`"): a
// counter-proposal. The times are `sessions.remedy.counterOptions`' as the server reads them when
// the sheet opens, each in its slot's zone and the viewer's; none of them is decided here. The
// chosen one is sent keyed (FR-106's rule, as the booking sheet keys a hold): a key minted when an
// option is chosen and kept for that option's retry, so a retry after a lost answer is one
// counter-proposal; another option, or another opening of the sheet, is a new action and a new key.
import type { CounterOption, SessionsGetOutput } from '@ijazah/contracts';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Choice, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { ZoneLines } from '../../../shared/room/components/ZoneLines';
import { NotLoaded } from '../../../shared/states';
import { useCounterOptions, useRemedyActions } from '../api';
import { Failure } from './Failure';
import { useSend } from './use-send';

interface Chosen {
  readonly option: CounterOption;
  readonly key: string;
}

const optionId = (option: CounterOption) => `${option.slotId}:${option.localDate}`;

export function CounterSheet({
  session,
  viewerZone,
  onClose,
}: {
  readonly session: SessionsGetOutput;
  readonly viewerZone: string;
  readonly onClose: () => void;
}) {
  const t = useT();
  const options = useCounterOptions(session.sessionId);
  const actions = useRemedyActions(session);
  const { busy, failure, send } = useSend(onClose);
  const [chosen, setChosen] = useState<Chosen | null>(null);

  function choose(option: CounterOption): void {
    if (chosen !== null && optionId(chosen.option) === optionId(option)) return;
    setChosen({ option, key: Crypto.randomUUID() });
  }

  const listed = options.data?.options;
  return (
    <Sheet open onClose={onClose} title={t('student.remedy.proposeOther')}>
      <Failure failure={failure} />
      <Text tone="muted">{t('student.remedy.counterSheet.text')}</Text>
      {listed === undefined ? (
        <NotLoaded
          failed={options.isError}
          error={options.error}
          onRetry={() => void options.refetch()}
        />
      ) : listed.length === 0 ? (
        <Text>{t('student.remedy.counterSheet.empty')}</Text>
      ) : (
        <View style={{ gap: tokens.space['2'] }}>
          {listed.map((option) => (
            <Choice
              key={optionId(option)}
              selected={chosen !== null && optionId(chosen.option) === optionId(option)}
              onPress={() => choose(option)}
              label={
                <ZoneLines
                  instant={option.startsAt}
                  sessionZone={option.timezone}
                  viewerZone={viewerZone}
                />
              }
            />
          ))}
        </View>
      )}
      {listed === undefined || listed.length === 0 ? null : (
        <Button
          label={t('student.remedy.counterSheet.send')}
          layout="block"
          loading={busy}
          disabled={busy || chosen === null}
          onPress={() => {
            if (chosen === null) return;
            void send(() => actions.counter(chosen.option, chosen.key));
          }}
        />
      )}
      <Button label={t('common.action.cancel')} variant="ghost" layout="block" onPress={onClose} />
    </Sheet>
  );
}
