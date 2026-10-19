// T027 (FR-138, R-HONEST-4): the field names no user-facing output may carry, each with the reason,
// and the one place a name is allowed. The output leak test (`output-leak.spec.ts`) reads every
// output field of the user surface in the contract snapshot and compares the last segment of each
// field's path, without case and without underscores (`date_of_birth` is `dateofbirth`), with each
// entry: `exact` for a name, `suffix` and `prefix` for the families kernel.md "Two new pipeline
// gates" lists (`storageKey*`, `*Hash`, `recipientRef*`, `mfaSecret*`; review of B7, finding 2).
//
// An entry joins when a table gains a column no other person may see; one leaves never (a field
// the list stops naming is a field the test stops guarding).

export interface ForbiddenName {
  /** Lower case, no underscores. */
  readonly name: string;
  readonly match: 'exact' | 'prefix' | 'suffix';
  readonly reason: string;
}

export const forbiddenOutputNames: readonly ForbiddenName[] = [
  { name: 'dateofbirth', match: 'exact', reason: "another person's date of birth (R-HONEST-4)" },
  { name: 'dob', match: 'exact', reason: "another person's date of birth (R-HONEST-4)" },
  { name: 'isminor', match: 'exact', reason: 'whether another person is a minor (R-HONEST-4)' },
  {
    name: 'genderflags',
    match: 'exact',
    reason: "another person's gender-dispute history (R-HONEST-4)",
  },
  { name: 'password', match: 'exact', reason: 'a password (FR-138)' },
  {
    name: 'storagekey',
    match: 'prefix',
    reason: 'a document storage key: files are reached through signed links only (FR-138)',
  },
  {
    name: 'storagekey',
    match: 'suffix',
    reason: "a document's storage key (the certificate's, FR-138)",
  },
  {
    name: 'photokey',
    match: 'exact',
    reason: "a photo's storage key: the photo is reached through a signed link (FR-138)",
  },
  {
    name: 'attachmentkey',
    match: 'exact',
    reason: "a chat attachment's storage key (FR-138)",
  },
  {
    name: 'hash',
    match: 'suffix',
    reason: 'a hash of a password, a code, a token or an account reference (FR-138)',
  },
  {
    name: 'encrypted',
    match: 'suffix',
    reason: 'a value encrypted at rest: a key, a secret, a token or an account reference (FR-138)',
  },
  { name: 'mfasecret', match: 'prefix', reason: 'a second-factor secret (FR-138)' },
  {
    name: 'providersubject',
    match: 'exact',
    reason: "a sign-in provider's subject for the person (FR-138)",
  },
  {
    name: 'recipientref',
    match: 'prefix',
    reason: "the gateway's recipient reference for a payout account (FR-138)",
  },
  {
    name: 'payoutaccountref',
    match: 'prefix',
    reason: "the gateway's payout account reference (FR-138)",
  },
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
