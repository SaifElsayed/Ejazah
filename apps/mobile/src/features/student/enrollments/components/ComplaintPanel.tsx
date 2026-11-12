// T042 of specs/004-sessions (FR-452, FR-495; SRS FR-NOSHOW-4; T060): the student's complaint of the
// teacher's absence on the enrollment's screen. On a `confirmed` enrollment, a button taking a
// mandatory free-text reason (`ReasonForm`, the notes under T042, Q4), then, while `enrollments.get`'s
// `complaintOpen` is true, the button reads «شكوتك قيد المراجعة» and does nothing. Refusals in the
// complaint's own words (`complaintRefusal`). The hook and the server decide; this draws.
import type { EnrollmentsGetOutput } from '@ijazah/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import type { ErrorMessage } from '../../../../lib/error-message';
import { ReasonForm } from '../../../shared/sessions';
import { complaintRefusal, complaintStateOf, useRaiseComplaint } from '../complaint';

export function ComplaintPanel({ enrollment }: { readonly enrollment: EnrollmentsGetOutput }) {
  const t = useT();
  const complaints = useRaiseComplaint(enrollment.enrollmentId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | undefined>(undefined);
  const state = complaintStateOf(enrollment);
  if (state === 'none') return null;
  if (state === 'open') {
    // A `COMPLAINT_OPEN` refusal reads the enrollment again, which turns the form into this.
    return (
      <View style={{ gap: tokens.space['2'] }}>
        {failure === undefined ? null : <Text tone="danger">{t(failure.key, failure.values)}</Text>}
        <Button
          label={t('student.complaint.open')}
          variant="secondary"
          layout="block"
          disabled
          onPress={() => undefined}
        />
      </View>
    );
  }
  async function send(text: string): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      if ((await complaints.raise(text)) !== undefined) setOpen(false);
    } catch (caught: unknown) {
      setFailure(complaintRefusal(caught));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <Button
        label={t('student.complaint.raise')}
        variant="secondary"
        layout="block"
        onPress={() => setOpen(true)}
      />
    );
  }
  return (
    <Card variant="surface">
      <ReasonForm
        words={{
          label: t('student.complaint.form.reason'),
          hint: t('student.complaint.form.hint'),
          send: t('student.complaint.form.send'),
          back: t('student.complaint.form.back'),
          tooLong: t('student.complaint.form.tooLong'),
        }}
        busy={busy}
        failure={failure === undefined ? undefined : t(failure.key, failure.values)}
        onSend={(text) => void send(text)}
        onBack={() => {
          setOpen(false);
          setFailure(undefined);
        }}
      />
    </Card>
  );
}
