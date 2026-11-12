// B42 lane S: the idempotency key a keyed dialog mints when it opens (`sessions.review.revise`,
// `cases.openManual`; the kernel's key, 16 to 128 of `A–Z a–z 0–9 _ -`, FR-106). A random UUID is
// 36 such characters; the dialog keeps it for its life, so its retry reuses it.
export function mintIdempotencyKey(): string {
  return crypto.randomUUID();
}
