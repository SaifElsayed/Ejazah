// T026 fixture — VIOLATION of R-API-10, the `@ts-ignore` half: a compiler suppression with no
// justification and no ticket, silencing a real error. The `any` half is
// `modules/notifications/payload-cast.ts`.
// Refused by api/require-escape-hatch-reason.
// @ts-ignore
export const openReportCount: number = 'many';
