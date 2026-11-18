// T021 of specs/005-certification (FR-611, FR-614): the way into the report and flag sheet. A
// header's flag icon («إبلاغ», `common.a11y.report`) on a session's screen and in the chat, or a
// labelled button where the screen gives one (the teacher's profile, `student.teacherProfile.report`).
// The sheet opens over the screen, a fresh one each time.
import { useState } from 'react';

import { Button, IconButton } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import type { ReportTarget } from '../reasons';
import { ReportSheet } from './ReportSheet';

export function ReportEntry({
  target,
  label,
}: {
  readonly target: ReportTarget;
  /** The button's words; the header's icon when absent. */
  readonly label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {label === undefined ? (
        <IconButton
          icon={{ name: 'flag' }}
          accessibilityLabel={t('common.a11y.report')}
          onPress={() => setOpen(true)}
        />
      ) : (
        <Button
          label={label}
          variant="ghost"
          icon={{ name: 'flag' }}
          onPress={() => setOpen(true)}
        />
      )}
      {open ? <ReportSheet target={target} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
