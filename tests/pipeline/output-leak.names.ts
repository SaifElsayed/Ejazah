// T027 (FR-138, R-HONEST-4): the field names no user-facing output may carry, each with the reason,
// and the one place a name is allowed. The output leak test (`output-leak.spec.ts`) reads every
// output field of the user surface in the contract snapshot and refuses a field whose last segment
// is one of these names, compared without case and without underscores (`date_of_birth` is
// `dateOfBirth`).
//
// A name joins when a table gains a column no other person may see; one leaves never (a field the
// list stops naming is a field the test stops guarding).

export interface ForbiddenName {
  readonly name: string;
  readonly reason: string;
}

export const forbiddenOutputNames: readonly ForbiddenName[] = [
  { name: 'dateOfBirth', reason: "another person's date of birth (R-HONEST-4)" },
  { name: 'dob', reason: "another person's date of birth (R-HONEST-4)" },
  { name: 'isMinor', reason: 'whether another person is a minor (R-HONEST-4)' },
  {
    name: 'storageKey',
    reason: 'a document storage key: files are reached through signed links only (FR-138)',
  },
  { name: 'storageKeyEncrypted', reason: 'a document storage key, encrypted at rest (FR-138)' },
  {
    name: 'photoKey',
    reason: "a photo's storage key: the photo is reached through a signed link (FR-138)",
  },
  { name: 'passwordHash', reason: 'a password hash (FR-138)' },
  { name: 'mfaSecret', reason: 'a second-factor secret (FR-138)' },
  { name: 'mfaSecretEncrypted', reason: 'a second-factor secret, encrypted at rest (FR-138)' },
  { name: 'codeHash', reason: 'a one-time code or recovery code hash (FR-138)' },
  { name: 'tokenHash', reason: 'a session or refresh token hash (FR-138)' },
  { name: 'providerSubject', reason: "a sign-in provider's subject for the person (FR-138)" },
  { name: 'providerRefreshTokenEncrypted', reason: "a sign-in provider's refresh token (FR-138)" },
  {
    name: 'recipientRef',
    reason: "the gateway's recipient reference for a payout account (FR-138)",
  },
  { name: 'payoutAccountRefEncrypted', reason: "the gateway's payout account reference (FR-138)" },
  { name: 'genderFlags', reason: "another person's gender-dispute history (R-HONEST-4)" },
];

export interface AllowedOutputField {
  readonly procedure: string;
  readonly field: string;
  readonly reason: string;
}

/**
 * Fields allowed although their name is forbidden, by procedure and full field path. Written as an
 * allowance, never as a presence assertion: `account.me` arrives with T049 (B10).
 */
export const allowedOutputFields: readonly AllowedOutputField[] = [
  {
    procedure: 'account.me',
    field: '$.dateOfBirth',
    reason: "the person's own date of birth, on their own account screen",
  },
];

/** The session tokens a keyed procedure's output never carries: a stored outcome is replayed as stored. */
export const tokenOutputNames: readonly string[] = [
  'accessToken',
  'refreshToken',
  'sessionToken',
  'onboardingToken',
];
