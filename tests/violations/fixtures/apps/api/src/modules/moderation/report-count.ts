// T026 fixture — VIOLATION of R-API-10, the `@ts-ignore` half: a compiler suppression with no
// justification comment and no ticket. The directive silences a real assignment error on the
// line below it, which is the point — the compiler had something to say and nobody recorded why
// it was ignored.
// Paired with `modules/notifications/payload-cast.ts`, which carries the `any` half; the two run
// through different mechanisms under one identifier.
// Refused by api/require-escape-hatch-reason.
// @ts-ignore
export const openReportCount: number = 'many';
