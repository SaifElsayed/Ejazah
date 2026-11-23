// T073 (FR-175): the selected entry's detail (`AdminAudit`'s panel). Its action and target, when and
// by whom; what it changed, field by field, before then after (an entry holds what its action
// wrote, so many hold an after alone): a standing as its badge, a chain by its generations, a day
// as a day, anything else as stored; its reason; its number and its target. Entries are only ever
// added (the footer). R1a (002:T174; SRS DEC-97, FR-ADMIN-17 as amended; the owner's Q-1 (a)): a
// reason kept in a history is stored as the marker `note_given` and said in words, linked to the
// entry's target, here and in the list (`AuditReason`); the marker itself is never shown.
// 003:T126 (SRS DEC-96's last clause; Q15 (a)): a release's mark and unmark name the release in
// `after`; its amount reads in pounds (the payouts page's formatter), its part in the payouts page's
// words, never as stored.
import type { ShareReleaseMilestone } from '@ijazah/contracts';
import { AUDIT_REASON_NOTE_GIVEN } from '@ijazah/contracts/admin';
import { isPiasters } from '@ijazah/money';
import { useNavigate } from 'react-router';

import {
  Badge,
  Banner,
  IconTile,
  KeyValue,
  Panel,
  Skeleton,
  TextLink,
} from '../../design/components';
import { type MessageKey, useLocale, useT } from '../../i18n';
import { errorMessageKey } from '../../lib/error-message';
import { dayMonthYear, formatPounds, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { DECISION_REASONS } from '../applications/DecisionDialog';
import { PART } from '../payouts/words';
import { actionText, targetHref, targetText } from './actions';
import { type AuditEntry as Entry, useAuditEntry } from './queries';

const FIELD_TEXT: Readonly<Record<string, MessageKey>> = {
  accountStatus: 'admin.audit.fields.accountStatus',
  isActive: 'admin.audit.fields.isActive',
  status: 'admin.audit.fields.status',
  verificationStatus: 'admin.audit.fields.verificationStatus',
  completedOn: 'admin.audit.fields.completedOn',
  outcome: 'admin.audit.fields.outcome',
  holderName: 'admin.audit.fields.holderName',
  riwaya: 'admin.audit.fields.riwaya',
  tariq: 'admin.audit.fields.tariq',
  chain: 'admin.audit.fields.chain',
  reasonChoice: 'admin.audit.fields.reasonChoice',
  needed: 'admin.audit.fields.needed',
  applicationStatus: 'admin.audit.fields.applicationStatus',
  subjectIds: 'admin.audit.fields.subjectIds',
  requestId: 'admin.audit.fields.requestId',
  documentId: 'admin.audit.fields.documentId',
  // 003:T126: the release a mark or an unmark touched.
  releaseId: 'admin.audit.fields.releaseId',
  enrollmentId: 'admin.audit.fields.enrollmentId',
  milestone: 'admin.audit.fields.milestone',
  amount_piasters: 'admin.audit.fields.amount',
};

/** The standings the panel already names, by field. */
const STANDING_TEXT: Readonly<Record<string, Readonly<Record<string, MessageKey>>>> = {
  accountStatus: {
    active: 'admin.status.account.active',
    suspended: 'admin.status.account.suspended',
    verification_required: 'admin.status.account.verificationPending',
    banned: 'admin.status.account.banned',
  },
  status: {
    pending: 'admin.status.credential.inReview',
    needs_document: 'admin.status.credential.anotherFileNeeded',
    approved: 'admin.status.credential.verified',
    rejected: 'admin.status.credential.rejected',
  },
  verificationStatus: {
    pending: 'admin.audit.values.verification.pending',
    approved: 'admin.audit.values.verification.approved',
    rejected: 'admin.audit.values.verification.rejected',
    revoked: 'admin.audit.values.verification.revoked',
  },
  outcome: {
    suitable: 'admin.applications.detail.suitable',
    unsuitable: 'admin.applications.detail.unsuitable',
  },
};

/**
 * An application decision's own words (T116 (c)): its `status` is the application's, not a
 * credential's, and its reasons are its dialog's. A value with no word is shown as stored.
 */
const APPLICATION_STATUS_TEXT: Readonly<Record<string, MessageKey>> = {
  in_review: 'admin.status.application.inReview',
  needs_document: 'admin.status.application.waitingOnApplicant',
  approved: 'admin.status.application.approved',
  rejected: 'admin.status.application.rejected',
  banned: 'admin.status.application.banned',
};
/** A reason the dialog no longer offers, still named in older entries (T155). */
const RETIRED_REASON_TEXT: Readonly<Record<string, MessageKey>> = {
  ijazah_unreadable: 'admin.audit.values.retiredReasons.ijazahUnreadable',
};
const DECISION_OF_ACTION: Readonly<Record<string, keyof typeof DECISION_REASONS>> = {
  'application.reject': 'reject',
  'application.request_info': 'requestInfo',
  'application.ban': 'ban',
};

/** The word the panel has for `value` of `field` in an entry of `action`, if it has one. */
function wordOf(action: string, field: string, value: string): MessageKey | undefined {
  if ((action.startsWith('application.') && field === 'status') || field === 'applicationStatus') {
    return APPLICATION_STATUS_TEXT[value];
  }
  if (action.startsWith('payout_release.') && field === 'milestone') {
    return Object.hasOwn(PART, value) ? PART[value as ShareReleaseMilestone] : undefined;
  }
  const decision = DECISION_OF_ACTION[action];
  if (decision !== undefined && (field === 'reasonChoice' || field === 'needed')) {
    return DECISION_REASONS[decision].get(value) ?? RETIRED_REASON_TEXT[value];
  }
  return STANDING_TEXT[field]?.[value];
}

export function AuditEntry({ entryId }: { readonly entryId: string }) {
  const t = useT();
  const entry = useAuditEntry(entryId);
  const loadFailure = errorMessageKey(entry.error, 'admin.common.loadError.text');
  if (entry.data === undefined) {
    return entry.isError ? (
      <Banner icon={{ name: 'alert-circle' }} tone="danger">
        {t(loadFailure.key, loadFailure.values)}
      </Banner>
    ) : (
      <Skeleton shape="block" />
    );
  }
  return <Detail entry={entry.data} />;
}

function Detail({ entry }: { readonly entry: Entry }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const zone = panelTimeZone();
  const target = targetText(entry, t);
  const href = targetHref(entry);
  const changes = changesOf(entry.before, entry.after);
  const valueOf = (field: string, value: unknown) => {
    const word = typeof value === 'string' ? wordOf(entry.action, field, value) : undefined;
    if (word !== undefined) {
      return field === 'reasonChoice' || field === 'milestone' ? (
        <span>{t(word)}</span>
      ) : (
        <Badge label={t(word)} tone="neutral" />
      );
    }
    if (Array.isArray(value) && field !== 'chain') {
      return (
        <span>
          {value
            .map((item) => {
              const itemWord =
                typeof item === 'string' ? wordOf(entry.action, field, item) : undefined;
              return itemWord === undefined ? plainText(field, item, t, locale, zone) : t(itemWord);
            })
            .join(locale === 'ar' ? '، ' : ', ')}
        </span>
      );
    }
    if (typeof value === 'boolean') {
      return (
        <Badge
          label={t(value ? 'admin.audit.values.yes' : 'admin.audit.values.no')}
          tone="neutral"
        />
      );
    }
    return <span>{plainText(field, value, t, locale, zone)}</span>;
  };

  return (
    <Panel
      header={
        <>
          <IconTile icon={{ name: 'list', size: 'lg' }} size="lg" tone="neutral" />
          <span className="stack grow">
            <strong className="text-title-3">
              {t('admin.audit.detail.title', { action: actionText(entry.action, t), target })}
            </strong>
            <span className="text-caption tone-muted">
              {t('admin.audit.detail.meta', {
                date: dayMonthYear(entry.occurredAt, locale, zone),
                time: timeOfDay(entry.occurredAt, locale, zone),
                admin: entry.adminName,
              })}
            </span>
          </span>
        </>
      }
      note={t('admin.audit.detail.footer')}
    >
      {changes.length === 0 ? null : (
        <section className="section">
          <h2 className="group-label">{t('admin.audit.detail.beforeAfter')}</h2>
          <KeyValue
            items={changes.map(({ field, before, after }) => ({
              label: FIELD_TEXT[field] === undefined ? field : t(FIELD_TEXT[field]),
              value: (
                <span className="row wrap gap-2">
                  {before === undefined ? null : (
                    <>
                      {valueOf(field, before)}
                      <span aria-hidden="true">{locale === 'ar' ? '←' : '→'}</span>
                    </>
                  )}
                  {after === undefined ? (
                    <span>{t('admin.audit.values.none')}</span>
                  ) : (
                    valueOf(field, after)
                  )}
                </span>
              ),
            }))}
          />
        </section>
      )}
      {entry.reason === undefined ? null : (
        <section className="section">
          <h2 className="group-label">{t('admin.audit.detail.reason')}</h2>
          <p className="text-callout">
            <AuditReason reason={entry.reason} action={entry.action} href={href} />
          </p>
        </section>
      )}
      <section className="section">
        <h2 className="group-label">{t('admin.audit.detail.entryTitle')}</h2>
        <KeyValue
          items={[
            {
              label: t('admin.audit.detail.entryNo'),
              value: <bdi className="ltr">{entry.entryId}</bdi>,
            },
            {
              label: t('admin.audit.detail.target'),
              value:
                href === undefined ? (
                  target
                ) : (
                  <TextLink label={target} href={href} onPress={() => void navigate(href)} />
                ),
            },
          ]}
        />
      </section>
    </Panel>
  );
}

/**
 * Which history holds the text of a `note_given` reason: a credential's entry (`credential.*`) the
 * credential's, any other the application's (R1a, the owner's answer to Q-A1-3, 2026-11-22).
 */
function noteGivenText(action: string): MessageKey {
  return action.startsWith('credential.')
    ? 'admin.audit.values.noteGivenCredential'
    : 'admin.audit.values.noteGiven';
}

/**
 * An entry's reason: as stored, or, for a reason kept in the application's or the credential's
 * history (R1a, Q-1 (a), Q-A1-3), the words that say which, a link to the entry's target where it
 * has a page.
 */
export function AuditReason({
  reason,
  action,
  href,
  className,
}: {
  readonly reason: string;
  readonly action: string;
  readonly href: string | undefined;
  readonly className?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  if (reason !== AUDIT_REASON_NOTE_GIVEN) return <bdi className={className}>{reason}</bdi>;
  const words = t(noteGivenText(action));
  return href === undefined ? (
    <span className={className}>{words}</span>
  ) : (
    <TextLink label={words} href={href} onPress={() => void navigate(href)} />
  );
}

/** The reason as the list's hover shows it in full: the marker in words, any other as stored. */
export function reasonTitle(reason: string, action: string, t: ReturnType<typeof useT>): string {
  return reason === AUDIT_REASON_NOTE_GIVEN ? t(noteGivenText(action)) : reason;
}

/** Each field the entry names, with its value before and after. */
function changesOf(
  before: unknown,
  after: unknown,
): { readonly field: string; readonly before: unknown; readonly after: unknown }[] {
  const was = recordOf(before);
  const is = recordOf(after);
  const fields = [...new Set([...Object.keys(was), ...Object.keys(is)])];
  return fields.map((field) => ({ field, before: was[field], after: is[field] }));
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A value with no badge, as text: a day as a day, a chain by its generations, a list joined. */
function plainText(
  field: string,
  value: unknown,
  t: ReturnType<typeof useT>,
  locale: 'ar' | 'en',
  zone: string,
): string {
  if (value === null || value === undefined) return t('admin.audit.values.none');
  if (field === 'chain' && Array.isArray(value)) {
    return t('admin.common.generations', { count: value.length });
  }
  if (field === 'completedOn' && typeof value === 'string')
    return dayMonthYear(value, locale, zone);
  if (field === 'amount_piasters' && typeof value === 'number' && isPiasters(value)) {
    return formatPounds(value, locale);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join(locale === 'ar' ? '، ' : ', ');
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
