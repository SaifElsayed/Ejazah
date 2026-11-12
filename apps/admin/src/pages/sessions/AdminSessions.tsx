// B42, T047 (FR-479, FR-460, FR-ADMIN-6; R-MONEY-6): `/sessions`, the enrollment and session
// monitor. The toolbar's status tabs, the student's and the teacher's names (each the start of the
// name, sent once the typing stops, `sessions.monitor.list` folding it, R-203) and the from–to local
// days (typed day first, `lib/day-field.ts`, a day that does not exist said and never sent) narrow
// the list, newest first as the server answers it, in keyset pages. Each row: the student and the
// teacher (a deleted one's stand-in, FR-426), the status, the sessions consumed and remaining, the
// Teacher-No-Show count and its mark (FR-451), and the next session in its own zone. A row opens the
// enrollment beside the list at `?enrollment=` (`EnrollmentPanel`), the link the other pages use.
// A failed read shows the page's generic words; T058 switches them to the rate limit's message.
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import {
  Badge,
  Banner,
  Button,
  CategoryTabs,
  DataTable,
  EmptyState,
  Field,
  Input,
  Page,
  Skeleton,
  Split,
  Toolbar,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { calendarDateOfDayField, dayFieldText } from '../../lib/day-field';
import { useSettled } from '../applications/queries';
import { NoShowMark, PartyName } from '../_shared';
import { EnrollmentPanel } from './EnrollmentPanel';
import { type EnrollmentStatus, type MonitorFilter, useMonitorPage } from './queries';
import { ENROLLMENT_STATUS, ENROLLMENT_STATUSES, ownTime } from './words';

/** The tab with no status filter. */
const ALL = 'all';
const WHOLE_DAY = 'DD/MM/YYYY'.length;

/** A day field's calendar date, and whether a whole one names no day. */
function dayOf(typed: string): { readonly date?: string; readonly invalid: boolean } {
  const date = calendarDateOfDayField(typed);
  if (date !== undefined) return { date, invalid: false };
  return { invalid: typed.length === WHOLE_DAY };
}

function DayField({
  label,
  value,
  invalid,
  onChange,
}: {
  readonly label: MessageKey;
  readonly value: string;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <Field
      label={t(label)}
      {...(invalid ? { error: t('admin.sessions.filters.dateInvalid') } : {})}
    >
      <Input
        value={value}
        onChangeText={(typed) => onChange(dayFieldText(typed))}
        keyboard="numeric"
        error={invalid}
        placeholder={t('admin.sessions.filters.datePlaceholder')}
      />
    </Field>
  );
}

export function AdminSessions() {
  const t = useT();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const selected = params.get('enrollment');
  const [status, setStatus] = useState<EnrollmentStatus | undefined>(undefined);
  const [studentTyped, setStudentTyped] = useState('');
  const [teacherTyped, setTeacherTyped] = useState('');
  const [fromTyped, setFromTyped] = useState('');
  const [toTyped, setToTyped] = useState('');
  const student = useSettled(studentTyped);
  const teacher = useSettled(teacherTyped);
  const from = dayOf(fromTyped);
  const to = dayOf(toTyped);
  // The cursor of each page read so far: the first page has none.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [page, setPage] = useState(1);
  const filter: MonitorFilter = {
    ...(status === undefined ? {} : { status }),
    ...(student === '' ? {} : { student }),
    ...(teacher === '' ? {} : { teacher }),
    ...(from.date === undefined ? {} : { from: from.date }),
    ...(to.date === undefined ? {} : { to: to.date }),
  };
  const list = useMonitorPage(filter, cursors[page - 1]);

  // A new filter starts at the first page, once the names settle: a keystroke reads nothing.
  const filters = JSON.stringify(filter);
  const [shownFor, setShownFor] = useState(filters);
  if (shownFor !== filters) {
    setShownFor(filters);
    setCursors([undefined]);
    setPage(1);
  }

  const listed = list.data;
  const next = listed?.nextCursor;
  const pageCount = page === cursors.length && next !== undefined ? page + 1 : cursors.length;
  const go = (target: number) => {
    if (target === cursors.length + 1 && next !== undefined) setCursors([...cursors, next]);
    setPage(target);
  };
  const unfiltered = filters === '{}' && page === 1;

  const table =
    listed === undefined ? (
      list.isError ? (
        <div className="stack gap-4">
          <Banner icon={{ name: 'alert-circle' }} tone="danger">
            <span className="stack gap-1">
              <strong>
                {t('admin.common.loadError.title', { page: t('admin.sessions.title') })}
              </strong>
              <span>{t('admin.common.loadError.text')}</span>
            </span>
          </Banner>
          <div className="row">
            <Button
              label={t('admin.common.action.retry')}
              variant="secondary"
              onPress={() => void list.refetch()}
            />
          </div>
        </div>
      ) : (
        <Skeleton shape="block" />
      )
    ) : listed.items.length === 0 ? (
      unfiltered ? (
        <EmptyState
          icon={{ name: 'calendar' }}
          title={t('admin.sessions.emptyAll.title')}
          text={t('admin.sessions.emptyAll.text')}
        />
      ) : (
        <EmptyState
          icon={{ name: 'search' }}
          title={t('admin.sessions.empty.title')}
          text={t('admin.sessions.empty.text')}
        />
      )
    ) : (
      <DataTable
        columns={[
          { key: 'student', header: t('admin.sessions.columns.student') },
          { key: 'teacher', header: t('admin.sessions.columns.teacher') },
          { key: 'status', header: t('admin.sessions.columns.status') },
          { key: 'progress', header: t('admin.sessions.columns.progress') },
          { key: 'noShows', header: t('admin.sessions.columns.noShows') },
          { key: 'next', header: t('admin.sessions.columns.next'), end: true },
        ]}
        rows={listed.items.map((row) => ({
          key: row.enrollmentId,
          cells: {
            student: <PartyName party={row.student} role="student" />,
            teacher: <PartyName party={row.teacher} role="teacher" />,
            status: (
              <Badge
                label={t(ENROLLMENT_STATUS[row.status].label)}
                tone={ENROLLMENT_STATUS[row.status].tone}
              />
            ),
            progress: t('admin.sessions.progress', {
              done: row.completed,
              total: row.sessionCount,
              remaining: row.remaining,
            }),
            noShows: (
              <NoShowMark
                teacherNoShows={row.teacherNoShows}
                repeatedAbsence={row.repeatedAbsence}
              />
            ),
            next:
              row.nextSession === undefined ? (
                <span className="tone-muted">{t('admin.sessions.noNext')}</span>
              ) : (
                ownTime(row.nextSession, t, locale)
              ),
          },
        }))}
        {...(selected === null ? {} : { selectedKey: selected })}
        onSelect={(enrollmentId) => setParams({ enrollment: enrollmentId })}
        footer={{
          summary: t('admin.sessions.pagerPage', { page }),
          pager: { page, pageCount, onChange: go },
        }}
      />
    );

  return (
    <Page title={t('admin.sessions.title')} subtitle={t('admin.sessions.lede')}>
      <Toolbar>
        <CategoryTabs
          accessibilityLabel={t('admin.common.a11y.status')}
          value={status ?? ALL}
          onChange={(value) =>
            setStatus(value === ALL ? undefined : ENROLLMENT_STATUSES.find((one) => one === value))
          }
          tabs={[
            { value: ALL, label: t('admin.common.action.all') },
            ...ENROLLMENT_STATUSES.map((one) => ({
              value: one,
              label: t(ENROLLMENT_STATUS[one].label),
            })),
          ]}
        />
      </Toolbar>
      <div className="grid-4 gap-3">
        <Field label={t('admin.sessions.filters.student')}>
          <Input
            value={studentTyped}
            onChangeText={setStudentTyped}
            placeholder={t('admin.sessions.filters.namePlaceholder')}
          />
        </Field>
        <Field label={t('admin.sessions.filters.teacher')}>
          <Input
            value={teacherTyped}
            onChangeText={setTeacherTyped}
            placeholder={t('admin.sessions.filters.namePlaceholder')}
          />
        </Field>
        <DayField
          label="admin.sessions.filters.from"
          value={fromTyped}
          invalid={from.invalid}
          onChange={setFromTyped}
        />
        <DayField
          label="admin.sessions.filters.to"
          value={toTyped}
          invalid={to.invalid}
          onChange={setToTyped}
        />
      </div>
      <p className="text-caption tone-muted">{t('admin.sessions.filters.datesHint')}</p>
      <Split
        detailLabel={t('admin.sessions.detail.a11y')}
        list={table}
        {...(selected === null
          ? {}
          : { detail: <EnrollmentPanel key={selected} enrollmentId={selected} /> })}
      />
    </Page>
  );
}
