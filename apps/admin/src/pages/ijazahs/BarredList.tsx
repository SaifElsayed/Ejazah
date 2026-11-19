// 005:T022 (B49; FR-610; the note under T022, Q-P2 (b)): the students barred from receiving
// ijazahs, the ijazahs page's own tab, as `ijazahs.barred` answers them: the open bars, newest first,
// in keyset pages. A barred student gets no new request, so a student barred with no ijazah has no
// other page to lift the bar from. Each row: the student, leading to their record (`/users?user=`;
// a deleted account by the directory's words), since when, by whom and why, and the lift with a
// reason (`LiftDialog`). The list says so when no one is barred.
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { Banner, Button, EmptyState, Pager, Skeleton, TextLink } from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { type BarredRow, useBarredPage } from './queries';
import { LiftDialog, useStudentName } from './StudentBar';

export function BarredList() {
  const t = useT();
  const locale = useLocale();
  const zone = panelTimeZone();
  const navigate = useNavigate();
  const nameOf = useStudentName();
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const [lifting, setLifting] = useState<BarredRow | null>(null);
  const list = useBarredPage(cursors[page - 1]);

  const listed = list.data;
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };

  const body = (() => {
    if (listed === undefined) {
      if (!list.isError) return <Skeleton shape="block" />;
      const failure = errorMessageKey(list.error, 'admin.common.loadError.text');
      return (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            {t(failure.key, failure.values)}
          </Banner>
          <div className="row">
            <Button
              label={t('admin.common.action.retry')}
              variant="secondary"
              onPress={() => void list.refetch()}
            />
          </div>
        </div>
      );
    }
    if (listed.items.length === 0 && page === 1) {
      return (
        <EmptyState
          icon={{ name: 'ban' }}
          title={t('admin.ijazahs.barredEmpty.title')}
          text={t('admin.ijazahs.barredEmpty.text')}
        />
      );
    }
    return (
      <>
        <ul className="stack gap-3">
          {listed.items.map((row) => {
            const href = `/users?user=${row.student.userId}`;
            return (
              <li key={row.barId} className="row wrap gap-2 text-callout">
                <span className="stack gap-1 grow">
                  <TextLink
                    label={nameOf(row.student)}
                    href={href}
                    onPress={() => void navigate(href)}
                  />
                  <span className="text-caption tone-muted">
                    {t('admin.ijazahs.barred.meta', {
                      date: dayMonthYear(row.barredAt, locale, zone),
                      admin: row.barredBy.displayName,
                      reason: row.reason,
                    })}
                  </span>
                </span>
                <Button
                  label={t('admin.ijazahs.barred.lift')}
                  variant="secondary"
                  onPress={() => setLifting(row)}
                />
              </li>
            );
          })}
        </ul>
        <Pager page={page} pageCount={pageCount} onChange={go} />
      </>
    );
  })();

  return (
    <section className="section" aria-label={t('admin.ijazahs.barred.a11y')}>
      <h2 className="group-label">{t('admin.ijazahs.barred.heading')}</h2>
      <p className="text-caption tone-muted">{t('admin.ijazahs.barred.note')}</p>
      {body}
      {lifting === null ? null : (
        <LiftDialog student={lifting.student} onClose={() => setLifting(null)} />
      )}
    </section>
  );
}
