# features

Three trees, one wall (ARCHITECTURE section 6.1). Enforced by `boundaries/no-cross-role-import` (R-MOBILE-1)
and `boundaries/no-role-import-in-shared` (R-MOBILE-2). A violation is a build error, not a review comment.

| Tree | May import | Never imports |
|---|---|---|
| `student/` | `shared/`, `design/`, `lib/`, `@ijazah/*` | `teacher/` |
| `teacher/` | `shared/`, `design/`, `lib/`, `@ijazah/*` | `student/` |
| `shared/` | `design/`, `lib/`, `@ijazah/*` | either role tree |

Every feature folder has the same shape: `api.ts`, `hooks.ts`, `components/`, `screens/`, `index.ts`.
`shared/` holds genuinely identical flows only. Duplication is cheaper than a wrong abstraction.
