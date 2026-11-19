// 003:T112 (SRS FR-POSTPONE-1 to FR-POSTPONE-4, DEC-86, DEC-90; the owner's Q-1 (a) of 2026-11-19):
// the postponement on an enrollment's screen, the same for both roles (R-MOBILE-3). On a confirmed
// enrollment that is not paused (`postponeOffered`), «تأجيل جلسات هذا الأسبوع» opens a sheet that
// says what it does before anything is sent: the caller's sessions of the enrollment in the coming
// seven days postponed with no consent asked, one too near its start standing (FR-POSTPONE-3), and
// each placed as a make-up is (FR-POSTPONE-2); then the mandatory free-text reason (`ReasonForm`,
// 1 to 500 characters once trimmed) whose send confirms it. A refusal in its own words
// (`postponementRefusal`), the sheet kept open with the reason; once it went through, the sheet
// closes and the enrollment, read again, shows the postponed sessions. The hook and the server
// decide; this draws.
import { useState } from 'react';

import { Button, Sheet, Text } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import type { ErrorMessage } from '../../../../lib/error-message';
import { ReasonForm } from '../../sessions';
import { postponementRefusal, postponeOffered, usePostpone } from '../postponement';

export function PostponePanel({
  enrollment,
}: {
  readonly enrollment: {
    readonly enrollmentId: string;
    readonly status: string;
    readonly paused: boolean;
  };
}) {
  const t = useT();
  const postponing = usePostpone(enrollment.enrollmentId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  if (!postponeOffered(enrollment)) return null;
  const close = () => {
    setOpen(false);
    setFailure(undefined);
  };
  async function send(text: string): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      if ((await postponing.postpone(text)) !== undefined) setOpen(false);
    } catch (caught: unknown) {
      setFailure(postponementRefusal(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        label={t('postponement.action')}
        variant="secondary"
        layout="block"
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Sheet open onClose={close} title={t('postponement.sheet.title')}>
          <Text>{t('postponement.sheet.week')}</Text>
          <Text tone="muted">{t('postponement.sheet.near')}</Text>
          <Text tone="muted">{t('postponement.sheet.makeup')}</Text>
          <ReasonForm
            words={{
              label: t('postponement.form.reason'),
              hint: t('postponement.form.hint'),
              send: t('postponement.form.send'),
              back: t('postponement.form.back'),
              tooLong: t('postponement.form.tooLong'),
            }}
            busy={busy}
            failure={failure === undefined ? undefined : t(failure.key, failure.values)}
            onSend={(text) => void send(text)}
            onBack={close}
          />
        </Sheet>
      ) : null}
    </>
  );
}
