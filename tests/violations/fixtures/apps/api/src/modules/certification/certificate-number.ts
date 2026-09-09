// T026 fixture — VIOLATION of R-DB-6: a public identifier drawn from non-cryptographic
// randomness, so a third party verifying one certificate can enumerate the rest.
// Refused by db/no-weak-random.
export function nextCertificateNumber(): string {
  return `IJZ-${Math.floor(Math.random() * 1_000_000)}`;
}
