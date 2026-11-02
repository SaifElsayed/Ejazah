// T025: discovery's cursor (research R-204; contracts `discoveryCursor`). The page is cut by
// identity's `visibleTeacherPage` after the last card's four order keys, its rating, review count,
// name and id; the server writes them into an opaque string and alone reads them back, so the
// client hands it back unread. A cursor the server did not write is the caller's invalid input
// (`VALIDATION_FAILED` on `cursor`), never the internal error. A crafted cursor that does decode
// moves only where the page starts: identity applies the predicate to every row after it.
import { type DiscoveryCursor, discoveryCursor } from '@ijazah/contracts';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { TeacherPageCursor } from '../identity/index.js';

/** `numeric(3,2)` as identity answers it, `4.5` or `5` or `4.67`; null for no review. */
const averageRating = z
  .string()
  .regex(/^\d(\.\d{1,2})?$/)
  .nullable();

const keys = z.tuple([averageRating, z.int().nonnegative(), z.string(), z.uuid()]);

/** The cursor after `last`, the page's last row. */
export function writeCursor(last: TeacherPageCursor): DiscoveryCursor {
  const json = JSON.stringify([last.averageRating, last.reviewCount, last.displayName, last.id]);
  return discoveryCursor.parse(Buffer.from(json, 'utf8').toString('base64url'));
}

function invalidCursor(): DomainError {
  return new DomainError('VALIDATION_FAILED', undefined, {
    details: [{ path: 'cursor', code: 'invalid' }],
  });
}

/** The four keys `cursor` carries; refuses one the server did not write. */
export function readCursor(cursor: string): TeacherPageCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const parsed = keys.safeParse(decoded);
  if (!parsed.success) throw invalidCursor();
  const [rating, reviewCount, displayName, id] = parsed.data;
  return { averageRating: rating, reviewCount, displayName, id };
}
