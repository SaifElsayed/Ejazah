// 005:T023 (B49; FR-612; the note under T023, Q-I1 (a)): the words the reports say, each by what
// the server answered. A report's status and context as `reports.list` names them, and a refused
// resolution by its code: `CONFLICT` `already_resolved` (`reportResolveRefusal`) in its own words
// (another key's conflict is the panel's reused-key words), `NOT_FOUND`, and `RATE_LIMITED` with
// when to try again through T058's `errorMessageKey`, which keeps the generic words for any other
// failure. A flag raised from a report is said in the gender page's words (`genderFlagFailure`).
import type { ReportContext } from '@ijazah/contracts';
import type { ReportResolveRefusal, ReportStatus } from '@ijazah/contracts/admin';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

export const REPORT_STATUS: Readonly<
  Record<ReportStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  open: { label: 'admin.status.report.open', tone: 'warning' },
  actioned: { label: 'admin.status.report.actioned', tone: 'success' },
  dismissed: { label: 'admin.status.report.dismissed', tone: 'neutral' },
};

export const REPORT_CONTEXT: Readonly<Record<ReportContext, MessageKey>> = {
  session: 'admin.reports.contexts.session',
  chat: 'admin.reports.contexts.chat',
  profile: 'admin.reports.contexts.profile',
};

/** Each refusal of `reports.resolve` (`reportResolveRefusal`), in its own words. */
const REFUSED: Readonly<Record<ReportResolveRefusal, MessageKey>> = {
  already_resolved: 'admin.reports.refused.alreadyResolved',
};

/** The words of a refused resolution. */
export function reportFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.reports.refused.notFound' };
    case 'CONFLICT': {
      const known = errorDetailsOf(error).find(({ code }) => Object.hasOwn(REFUSED, code));
      return {
        key:
          known === undefined
            ? 'admin.shared.keyReused'
            : REFUSED[known.code as ReportResolveRefusal],
      };
    }
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}
