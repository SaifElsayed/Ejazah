// 006:T019 (FR-708, SRS DEC-114; B-P4's conflict check, Q-5 (b)): the reminder on the enrollment's
// card and page, «ادفع قبل {date} {time}», with `payBy` in the student's zone, while the offer awaits
// payment and from the server's `payReminderFrom` on (`gates.ts` `payReminderOf`). A screen open
// before that instant draws the line when it comes: one timer to the instant, cleared on unmount.
import type { EnrollmentProgramme } from '@ijazah/contracts';
import { secondsUntil } from '@ijazah/time/calendar';
import { useEffect, useState } from 'react';

import { Banner } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { payReminderOf } from '../gates';

const SECOND_MS = 1_000;
/** The longest delay a timer keeps (2^31 − 1 ms, about 24 days); a longer one would fire at once. */
const LONGEST_TIMER_MS = 2_147_483_647;

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

export function PayReminder({
  programme,
  zone,
}: {
  /** The enrollment's marker; absent on an enrollment that is no programme. */
  readonly programme: EnrollmentProgramme | undefined;
  /** The student's zone. */
  readonly zone: string;
}) {
  const t = useT();
  const format = useFormatters();
  useRedrawAt(programme?.state === 'offered' ? programme.payReminderFrom : null);
  const payBy = payReminderOf(programme, new Date());
  if (payBy === null) return null;
  return (
    <Banner icon={{ name: 'clock' }} tone="warning">
      {t('programme.student.payReminder', {
        date: format.date(payBy, zone),
        time: format.time(payBy, zone),
      })}
    </Banner>
  );
}
