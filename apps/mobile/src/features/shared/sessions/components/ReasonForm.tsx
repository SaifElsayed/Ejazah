// T041 and T042 of specs/004-sessions: the free-text reason a participant writes, the same for a
// cancellation request, a dispute and a complaint of the teacher's absence (the notes under T041
// and T042, Q4: no preset reasons). The send waits for a reason the procedures take
// (`reason.ts`); the screen that holds the form sends it and says its failure.
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Field, Input, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { participantReasonOf, reasonTooLong } from '../reason';

export interface ReasonFormWords {
  readonly label: string;
  readonly hint: string;
  readonly send: string;
  readonly back: string;
  readonly tooLong: string;
}

export function ReasonForm({
  words,
  busy,
  failure,
  onSend,
  onBack,
}: {
  readonly words: ReasonFormWords;
  readonly busy: boolean;
  /** The failure of the last send, in the screen's words. */
  readonly failure: string | undefined;
  readonly onSend: (text: string) => void;
  readonly onBack: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <View style={{ gap: tokens.space['3'] }}>
      <Field
        label={words.label}
        hint={words.hint}
        {...(reasonTooLong(text) ? { error: words.tooLong } : {})}
      >
        <Input value={text} onChangeText={setText} multiline />
      </Field>
      {failure === undefined ? null : <Text tone="danger">{failure}</Text>}
      <View style={{ flexDirection: 'row', gap: tokens.space['2'] }}>
        <Button
          label={words.send}
          layout="grow"
          loading={busy}
          disabled={participantReasonOf(text) === undefined}
          onPress={() => onSend(text)}
        />
        <Button label={words.back} variant="ghost" layout="grow" onPress={onBack} />
      </View>
    </View>
  );
}
