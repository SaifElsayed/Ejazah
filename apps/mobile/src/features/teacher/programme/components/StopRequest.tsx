// 006:T020 (FR-723, FR-724; SRS DEC-112; B-P4's conflict check, Q-2 (a)): the teacher's stop request
// on a paused programme. The button shows only from the server's `stopRequestFrom` on (`gates.ts`
// `stopRequestShown`); a screen open before that instant draws it when it comes, one timer to the
// instant, cleared on unmount. It opens a sheet that says the administration decides, with the
// reason form (1 to 500, `ReasonForm`); `programme.request` kind `stop`. Once sent, a line says so in
// place of the button; each refusal (`too_early`, `request_open`, `not_paused`) in its own words.
import type { ProgrammeGetOutput } from '@ijazah/contracts';
import { secondsUntil } from '@ijazah/time/calendar';
import { useEffect, useState } from 'react';

import { Banner, Button, Sheet, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';
import { ReasonForm } from '../../../shared/sessions';
import { stopRequestShown } from '../gates';

const SECOND_MS = 1_000;
/** The longest delay a timer keeps (2^31 − 1 ms, about 24 days); a longer one would fire at once. */
const LONGEST_TIMER_MS = 2_147_483_647;

/** The stop request's refusals, each in its own words. */
const REFUSAL: Readonly<Record<string, ErrorMessage>> = {
  too_early: { key: 'programme.teacher.stop.refusal.too_early' },
  request_open: { key: 'programme.teacher.stop.refusal.request_open' },
  not_paused: { key: 'programme.teacher.stop.refusal.not_paused' },
};

function stopRefusalOf(caught: unknown): ErrorMessage {
  const cause = errorDetailsOf(caught).find(({ path }) => path === 'cause')?.code;
  const worded = cause === undefined ? undefined : REFUSAL[cause];
  return errorCodeOf(caught) === 'CONFLICT' && worded !== undefined
    ? worded
    : genericErrorKey(caught, 'common.state.actionError');
}

/** Draws again once `instant` comes, when it is still ahead. */
function useRedrawAt(instant: string | null): void {
  const [, setCome] = useState(0);
  useEffect(() => {
    if (instant === null) return undefined;
    const left = secondsUntil(instant, new Date());
    if (left === 0) return undefined;
    const ms = Math.min(left * SECOND_MS, LONGEST_TIMER_MS);
    const timer = setTimeout(() => setCome((count) => count + 1), ms);
    return () => clearTimeout(timer);
  }, [instant]);
}

export function StopRequest({
  programme,
  onSend,
}: {
  readonly programme: Pick<ProgrammeGetOutput, 'stopRequestFrom'>;
  readonly onSend: (reason: string) => Promise<unknown>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  useRedrawAt(programme.stopRequestFrom);
  if (sent) {
    return (
      <Banner icon={{ name: 'hourglass' }} tone="info">
        {t('programme.teacher.stop.sent')}
      </Banner>
    );
  }
  if (!stopRequestShown(programme, new Date())) return null;

  async function send(reason: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      await onSend(reason.trim());
      setOpen(false);
      setSent(true);
    } catch (caught: unknown) {
      setFailure(stopRefusalOf(caught));
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setFailure(null);
    setOpen(false);
  };

  return (
    <>
      <Button
        label={t('programme.teacher.stop.action')}
        variant="secondary"
        layout="block"
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Sheet open onClose={close} title={t('programme.teacher.stop.action')}>
          <Text tone="muted">{t('programme.teacher.stop.text')}</Text>
          <ReasonForm
            words={{
              label: t('programme.teacher.stop.reason'),
              hint: t('programme.teacher.stop.hint'),
              send: t('programme.teacher.stop.send'),
              back: t('programme.teacher.stop.back'),
              tooLong: t('programme.teacher.stop.tooLong'),
            }}
            busy={busy}
            failure={failure === null ? undefined : t(failure.key, failure.values)}
            onSend={(text) => void send(text)}
            onBack={close}
          />
        </Sheet>
      ) : null}
    </>
  );
}
