// T026 fixture — VIOLATION of R-DB-6: a public identifier drawn from non-cryptographic
// randomness. A certificate number is quoted by a third party verifying an ijazah, so a
// guessable one enumerates every certificate the platform has issued.
// No datetime is constructed, so `time/no-datetime-outside-package` (R-TIME-1) has nothing to
// refuse here; the only weakness is the source of the randomness.
// Refused by db/no-weak-random.
export function nextCertificateNumber(): string {
  return `IJZ-${Math.floor(Math.random() * 1_000_000)}`;
}
