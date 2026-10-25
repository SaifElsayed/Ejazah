// T073 (FR-176): the admin home (`AdminHome`, `AdminHomeEn`). Today's date in the panel's zone; the
// two queue cards this phase builds (the board's other six land with their phases), each with its
// open count and what it says of the oldest (from today when under a day), how many wait on the
// applicant, how many are for an added subject; then the latest actions as the audit names them,
// the whole log one link away. An empty list, and a summary that could not be read, are said.
import { useNavigate } from 'react-router';

import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  Page,
  QueueCard,
  Skeleton,
  TextLink,
} from '../../design/components';
import { useLocale, useT } from '../../i18n';
import { cityName, dayMonth, timeOfDay, weekdayDate } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { actionText, targetHref, targetText } from '../audit/actions';
import { useHomeSummary } from './queries';

const HOURS_A_DAY = 24;

export function AdminHome() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const zone = panelTimeZone();
  const summary = useHomeSummary();
  const answer = summary.data;

  /** What a card says of the oldest: its age in days, «from today» under a day. */
  const oldest = (hours: number | undefined) =>
    hours === undefined
      ? []
      : [
          hours < HOURS_A_DAY
            ? t('admin.home.queue.oldestToday')
            : t('admin.home.queue.oldest', { days: Math.floor(hours / HOURS_A_DAY) }),
        ];

  return (
    <Page
      title={t('admin.home.title')}
      subtitle={t('admin.home.subtitle', {
        date: weekdayDate(new Date().toISOString(), locale, zone),
        city: cityName(zone, locale),
      })}
    >
      {answer === undefined ? (
        summary.isError ? (
          <div className="stack gap-4">
            <Banner icon={{ name: 'alert-circle' }} tone="danger">
              <span className="stack gap-1">
                <strong>
                  {t('admin.common.loadError.title', { page: t('admin.home.title') })}
                </strong>
                <span>{t('admin.common.loadError.text')}</span>
              </span>
            </Banner>
            <div className="row">
              <Button
                label={t('admin.common.action.retry')}
                variant="secondary"
                onPress={() => void summary.refetch()}
              />
            </div>
          </div>
        ) : (
          <Skeleton shape="block" />
        )
      ) : (
        <>
          <section className="section" aria-labelledby="home-queues">
            <h2 id="home-queues" className="group-label">
              {t('admin.home.openQueues')}
            </h2>
            <div className="grid-4 gap-4">
              <QueueCard
                href="/applications"
                icon="user-check"
                title={t('admin.nav.items.applications')}
                count={answer.queues.applications.open}
                {...hintOf(
                  [
                    ...oldest(answer.queues.applications.oldestAgeHours),
                    ...(answer.queues.applications.waitingOnApplicant === 0
                      ? []
                      : [
                          t('admin.home.queue.waiting', {
                            waiting: answer.queues.applications.waitingOnApplicant,
                          }),
                        ]),
                  ],
                  locale,
                )}
                onNavigate={(href) => void navigate(href)}
              />
              <QueueCard
                href="/credentials"
                icon="file-text"
                title={t('admin.nav.items.credentials')}
                count={answer.queues.credentials.open}
                {...hintOf(
                  [
                    ...(answer.queues.credentials.addedSubjects === 0
                      ? []
                      : [
                          t('admin.home.queue.added', {
                            added: answer.queues.credentials.addedSubjects,
                          }),
                        ]),
                    ...oldest(answer.queues.credentials.oldestAgeHours),
                  ],
                  locale,
                )}
                onNavigate={(href) => void navigate(href)}
              />
            </div>
          </section>
          <section className="section" aria-labelledby="home-actions">
            <div className="section__header">
              <h2 id="home-actions" className="group-label">
                {t('admin.home.latestActions')}
              </h2>
              <TextLink
                label={t('admin.home.fullAuditLog')}
                href="/audit"
                onPress={() => void navigate('/audit')}
              />
            </div>
            {answer.latestActions.length === 0 ? (
              <EmptyState
                icon={{ name: 'list' }}
                title={t('admin.home.actionsEmpty.title')}
                text={t('admin.home.actionsEmpty.text')}
              />
            ) : (
              <DataTable
                columns={[
                  { key: 'time', header: t('admin.home.columns.time') },
                  { key: 'admin', header: t('admin.home.columns.admin') },
                  { key: 'action', header: t('admin.home.columns.action') },
                  { key: 'target', header: t('admin.home.columns.target') },
                ]}
                rows={answer.latestActions.map((row) => {
                  const href = targetHref(row);
                  const target = targetText(row, t);
                  return {
                    key: row.entryId,
                    cells: {
                      time: `${dayMonth(row.occurredAt, locale, zone)} · ${timeOfDay(row.occurredAt, locale, zone)}`,
                      admin: <bdi>{row.adminName}</bdi>,
                      action: actionText(row.action, t),
                      target:
                        href === undefined ? (
                          target
                        ) : (
                          <TextLink
                            label={target}
                            href={href}
                            onPress={() => void navigate(href)}
                          />
                        ),
                    },
                  };
                })}
              />
            )}
          </section>
        </>
      )}
    </Page>
  );
}

/**
 * The hint's parts with the board's separator, a part after the first in lower case in English as
 * the board writes it («… · oldest 2 days ago»; B14d-1 review); no hint when there are none.
 */
function hintOf(parts: readonly string[], locale: 'ar' | 'en'): { readonly hint?: string } {
  if (parts.length === 0) return {};
  const [first, ...rest] = parts;
  const later =
    locale === 'en' ? rest.map((part) => part.charAt(0).toLowerCase() + part.slice(1)) : rest;
  return { hint: [first, ...later].join(' · ') };
}
