// T018 and T019 of specs/004-sessions: the session's screens, identical for both roles but for the
// counterparty's stand-in and the role's routes, which each role's `features/*/sessions/` passes
// (R-MOBILE-3): the pre-session screen (FR-434) over `sessions.get`.
export { sessionQueryKey, useSessionRead } from './api';
export { PreSessionScreen } from './screens/PreSessionScreen';
