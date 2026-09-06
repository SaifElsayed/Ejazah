// The walls, as eslint-plugin-boundaries element definitions (T035).
// A violation is a build error, and the message ends with the constitution rule it enforces.
//
//   boundaries/no-cross-role-import      R-MOBILE-1  student <-> teacher trees
//   boundaries/no-role-import-in-shared  R-MOBILE-2  shared imports neither role tree
//   boundaries/no-deep-module-import     R-API-3     a module is imported only through index.ts
//   boundaries/no-adapter-import         R-API-4     a concrete adapter stays inside its port folder
//   boundaries/no-upward-admin-import    R-API-4     nothing imports upward into admin
//   boundaries/no-money-vocabulary       R-MONEY-6   wallet/ledger/balance/escrow banned everywhere; gateway amounts only in modules/payments and ports/payment (ADR 0007)
module.exports = [];
