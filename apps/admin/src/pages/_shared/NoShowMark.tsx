// B42 lane S (FR-451; T047, T049, T050, T058): an enrollment's Teacher-No-Show count and its
// repeated-absence mark, for administrators only, both as the server answered them: the count read
// when listed, the mark the server's `repeatedAbsence` (at `repeated_absence_flag_count`), never a
// threshold of the panel's. Nothing follows from the mark (SRS FR-NOSHOW-3), so no threshold or
// termination is said beside it; the board's `admin.disputes.detail.noShowCountValue` is never used.
import { Badge } from '../../design/components';
import { useT } from '../../i18n';

export function NoShowMark({
  teacherNoShows,
  repeatedAbsence,
}: {
  readonly teacherNoShows: number;
  readonly repeatedAbsence: boolean;
}) {
  const t = useT();
  return (
    <span className="row wrap gap-2">
      <span className="text-callout">
        {t('admin.shared.noShows.count', { count: teacherNoShows })}
      </span>
      {repeatedAbsence ? <Badge label={t('admin.shared.noShows.mark')} tone="warning" /> : null}
    </span>
  );
}
