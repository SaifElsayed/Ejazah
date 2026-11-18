// T018: the procedures a client may retry under an idempotency key (FR-106, R-DB-7;
// specs/002-identity/contracts/kernel.md "Idempotency", app-surface.md "Idempotency").
//
// Keying is a call the handler makes, so this list is what says which procedures key: the kernel's
// idempotency service accepts a scope from this list and nothing else, and the pipeline's output
// leak test (T027) asserts over the contract snapshot that none of these carries a token in its
// output, since a stored outcome is replayed as stored. `onboarding.complete` answers tokens and is
// therefore not here: its single use is the onboarding token's own `jti` mark.
//
// Additive-only once merged (R-API-9): a procedure joins when it is written, none leaves.

/** The keyed procedures of the user surface, by path. */
export const idempotentProcedures = [
  'teacher.application.submit',
  'account.delete',
  'teacher.payout.register',
  // Phase 2 (specs/003-booking/contracts/app-surface.md "Idempotent procedures").
  'teacher.packages.create',
  'teacher.slots.create',
  'checkout.hold',
  'checkout.pay',
  'checkout.retry',
  // Phase 3 (specs/004-sessions/contracts/app-surface.md, "`sessions.cancellation`"; T021).
  'sessions.cancellation.request',
  // Phase 3 (specs/004-sessions/contracts/app-surface.md, "`sessions.dispute`"; T026).
  'sessions.dispute.raise',
  // Phase 3 (specs/004-sessions/contracts/app-surface.md, "`sessions.remedy`"; T031, Q14 (a)).
  'sessions.remedy.counter',
  // Phase 3 (specs/004-sessions/contracts/admin-surface.md, "`cases`"; T064, Q1 (a)).
  'cases.openManual',
  // T059 of specs/004-sessions (admin-surface.md, `disputes.revise` and `sessions.review.revise`):
  // the administrator surface's first keyed procedures, keyed on the kind's transaction (runOn).
  'disputes.revise',
  'sessions.review.revise',
  // T037 of specs/004-sessions (app-surface.md, "`chat`"; B40's conflict check, F3).
  'chat.send',
  // T061 of specs/004-sessions (admin-surface.md, `sessions.restore`): keyed on the kind's
  // transaction (runOn), as T059's are.
  'sessions.restore',
  // T070 of specs/004-sessions (admin-surface.md, `enrollments.releaseSlot`): keyed on the kind's
  // transaction (runOn), as `sessions.restore` is.
  'enrollments.releaseSlot',
  // T072 of specs/004-sessions (admin-surface.md, `students.liftBan`, `teachers.liftBan`,
  // `teachers.liftRevocation`): keyed on the kind's transaction (runOn), as `sessions.restore` is.
  'students.liftBan',
  'teachers.liftBan',
  'teachers.liftRevocation',
  // T077 of specs/004-sessions (admin-surface.md, `teachers.keptData.setEraseDate` and
  // `teachers.keptData.eraseNow`): keyed on the kind's transaction (runOn), as T072's lifts are.
  'teachers.keptData.setEraseDate',
  'teachers.keptData.eraseNow',
  // T082 of specs/004-sessions (admin-surface.md, `sessions.endEnrollment`): keyed on the kind's
  // transaction (runOn), as `sessions.restore` is.
  'sessions.endEnrollment',
  // T081 of specs/004-sessions (admin-surface.md, `users.delete`): keyed on the kind's transaction
  // (runOn), as `sessions.restore` is.
  'users.delete',
  // T004 of specs/005-certification (app-surface.md, `account.certificateName.set`; admin-surface.md,
  // `users.setCertificateName`): the student's own in its own transaction (run), the administrator's
  // on the kind's transaction (runOn), as `users.delete` is.
  'account.certificateName.set',
  'users.setCertificateName',
  // T006 of specs/005-certification (app-surface.md, `teacher.ijazahRequests.send`): in its own
  // transaction (run), its stored outcome the request's id and status.
  'teacher.ijazahRequests.send',
  // T007 of specs/005-certification (admin-surface.md, `ijazahRequests.approve` and `.reject`):
  // keyed on the kind's transaction (runOn), as `users.delete` is; approve's stored outcome the
  // ijazah's id and number.
  'ijazahRequests.approve',
  'ijazahRequests.reject',
  // 005:T010 (admin-surface.md, `ijazahs.revoke`, `.bar` and `.liftBar`): keyed on the kind's
  // transaction (runOn), as the review's decisions are; revoke's stored outcome the number.
  'ijazahs.revoke',
  'ijazahs.bar',
  'ijazahs.liftBar',
  // 005:T032 (admin-surface.md, `ijazahs.signOff` and `.rerender`): keyed on the kind's transaction
  // (runOn); the stored outcome the certificate number.
  'ijazahs.signOff',
  'ijazahs.rerender',
  // 005:T011 (app-surface.md, `reports.create`; admin-surface.md, `reports.resolve`): the user's in
  // its own transaction (run), its stored outcome `{ received: true }`; the administrator's on the
  // kind's transaction (runOn).
  'reports.create',
  'reports.resolve',
  // 005:T013 (app-surface.md and admin-surface.md, `genderFlags.raise`; admin-surface.md,
  // `genderFlags.dismiss`): one scope for the path on both surfaces, the user's in its own
  // transaction (run), the administrator's on the kind's transaction (runOn); a key is the actor's
  // own (`(scope, actor_id, key)`, ERD §15 rule 26), so a user and an administrator never share one.
  'genderFlags.raise',
  'genderFlags.dismiss',
  // 005:T014 (admin-surface.md, `genderFlags.correct`): on the kind's transaction (runOn).
  'genderFlags.correct',
  // 005:T015 (admin-surface.md, `genderFlags.fraudBan`): on the kind's transaction (runOn).
  'genderFlags.fraudBan',
] as const;

/** A scope the idempotency service accepts: one of the keyed procedures. */
export type IdempotentProcedure = (typeof idempotentProcedures)[number];

/** Whether `scope` names a keyed procedure. */
export function isIdempotentProcedure(scope: string): scope is IdempotentProcedure {
  return (idempotentProcedures as readonly string[]).includes(scope);
}
