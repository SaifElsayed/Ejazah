// The walls (T035): where each one runs, and the words that give one away.
// A violation is a build error, and the message ends with the constitution rule it enforces.
//
//   boundaries/no-cross-role-import      R-MOBILE-1  student <-> teacher trees
//   boundaries/no-role-import-in-shared  R-MOBILE-2  shared imports neither role tree
//   boundaries/no-deep-module-import     R-API-3     a module is imported only through index.ts
//   boundaries/no-adapter-import         R-API-4     a concrete adapter stays inside its port folder
//   boundaries/no-upward-admin-import    R-API-4     nothing imports upward into admin
//   boundaries/no-money-vocabulary       R-MONEY-6   wallet/ledger/balance/escrow banned everywhere; gateway amounts only in modules/payments and ports/payment, and the monitor's contracts file and panel folder (ADR 0007, T052)
//
// DECISION (2026-09-09) — the six rules themselves live in the internal plugin, under
// `eslint-plugin-ijazah/rules/`, not in `eslint-plugin-boundaries` configuration as this file
// originally planned. The contract publishes those six ids; the library reports under its own
// (`boundaries/element-types`, `boundaries/no-private`), and `tests/violations/harness.ts` credits
// a rule only when the reported id equals the published id and the message ends with the
// constitution id. Configuration of that library could satisfy neither half, so FR-011 — a build
// log that leads to the prohibition — decided it. `eslint-plugin-boundaries` was never imported and was
// removed from `packages/config` on 2026-09-28 (develop health check after PR #20).
//
// What stays here is the wall itself: every path, folder and word the six rules compare against,
// in one place, so moving the mobile role tree or adding a held-funds synonym is one edit here
// rather than six edits spread through rule bodies. It reaches the rules as flat-config
// `settings`, which `packages/config/eslint.base.js` already spreads into both rule sets, and
// `eslint-plugin-ijazah/specifiers.js` reads this same object as its default so a rule linted
// standalone, with no `settings` at all, still knows where the wall is. There is no second copy.
//
// Paths are matched as runs of segments, never anchored at the repository root: the violation
// fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const wall = {
  // R-MOBILE-1, R-MOBILE-2 — the mobile role tree. The two roles never see each other;
  // shared is what both may depend on and depends on neither.
  roleTree: 'apps/mobile/src/features',
  roles: ['student', 'teacher'],
  sharedRole: 'shared',

  // R-API-3, R-API-4 (upward half) — the module tree and the module nothing points at.
  moduleRoot: 'apps/api/src/modules',
  adminModule: 'admin',

  // R-API-4 (upward half), T143 — the three composition files. They sit above every module, so
  // importing admin's public entry from them is not upward: `main.ts` and `worker.ts` bind admin's
  // `AuditWriter` and `SettingsReader` (T108, T113), and `admin.router.ts` mounts the module (T109).
  // Matched as the whole trailing run of segments of the importing file, so a lookalike
  // (`main.tsx`, `old/main.ts`, `admin.router.spec.ts`) is not one of them.
  adminCompositionFiles: [
    'apps/api/src/main.ts',
    'apps/api/src/worker.ts',
    'apps/api/src/surfaces/admin.router.ts',
  ],

  // R-API-4 (adapter half) — the port tree. A vendor's name lives inside one port folder.
  portRoot: 'apps/api/src/platform/ports',

  // Every spelling of a path the application ships. `apps/mobile/tsconfig.json` declares
  // `"@/*": ["src/*"]`, so `@/features/teacher/x` and `../teacher/x` name one file; a wall that
  // saw only the relative form was open through the alias a screen is most likely to be written
  // with. A prefix here is expanded before the relative check in `specifiers.js`.
  aliases: { '@/': 'apps/mobile/src/' },

  // R-MONEY-6 (a) — refused anywhere. The platform holds no funds, so there is no account
  // to credit and no balance to compute (ADR 0007). A term of several words matches a name
  // carrying all of them, singular or plural on either side, so `held_funds` also catches
  // `heldFunds`, `funds_held` and `heldFund`.
  bannedVocabulary: ['wallet', 'ledger', 'balance', 'escrow', 'held_funds', 'platform_funds'],

  // R-MONEY-6 (b) — refused outside `paymentFolders`: a name pairing a gateway word with an
  // amount marker. The ERD's gateway columns are `gross_piasters`, `gateway_fee_piasters` and
  // `net_piasters`, so the words alone catch all three in any spelling (`grossPiasters`), and no
  // list of special names is needed. A generic `amount` is NOT a gateway word: `amountPiasters`
  // in a formatter or in `packages/money` is legal, because the gross column is named for what it
  // is (decided by Amr, second review of PR #20; ERD `payments`). A gateway *order* reference is
  // not an amount either: ARCHITECTURE hands the client a `CheckoutRef` carrying the order id.
  // `payout` is in neither list and is legal: a teacher payout account is part of ADR 0007.
  //
  // No folder beyond these two is exempt, `packages/money` included. The money package is where
  // R-MONEY-5 allows piaster arithmetic, so it is exactly where `net = gross - fee`, which ADR 0007
  // forbids computing anywhere, would otherwise be written unseen.
  //
  // The admin's payments monitor (T052; the owner's decision of 2026-11-04): FR-400 asks it for
  // gross, fee and net as reported, so the leave widens by exactly one contracts file and one panel
  // folder, which only show the reported figures; not `apps/admin` as a whole and not
  // `packages/contracts`. Each entry is a whole run of segments, so `payments.ts.bak`,
  // `payments-extra.ts` and `pages/payments-old/` are not it
  // (`tests/lint-plugin/no-money-vocabulary-monitor.spec.ts`).
  gatewayAmountWords: ['gross', 'fee', 'net'],
  amountMarkerWords: ['piasters', 'amount', 'total', 'cents'],
  paymentFolders: [
    'apps/api/src/modules/payments',
    'apps/api/src/platform/ports/payment',
    'packages/contracts/src/admin/payments.ts',
    'apps/admin/src/pages/payments',
  ],
};

module.exports = [{ settings: { ijazah: { boundaries: wall } } }];

// The same object, for `eslint-plugin-ijazah/specifiers.js` to fall back to. The flat-config
// array stays the default export because that is what `eslint.base.js` spreads.
module.exports.boundaries = wall;
