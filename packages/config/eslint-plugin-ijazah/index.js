// The internal lint plugin (T034). Every rule is named for the constitution rule it enforces,
// and every declared message template ends with that identifier (FR-011) — appended by
// `./rule.js`, never typed by hand. A rule reporting a raw string instead of a declared message is
// caught at runtime by `tests/violations/harness.ts`. Rule ids are additive-only (R-API-9).
// Mapping: specs/001-foundations/contracts/lint-rules.md
//
// The catalog below is the plugin's single source of truth. `rules`, `configs.fast.rules` and
// `configs.typeAware.rules` are all derived from it, so a rule cannot be registered under one id
// and configured under another, cannot be registered and left unconfigured, and cannot land in
// both sets. Three hand-kept lists could drift; one table cannot disagree with itself.
//
// The six `boundaries/*` ids the contract publishes are rules of this plugin too, since T035.
// They were going to be `eslint-plugin-boundaries` configuration; that library reports under its
// own rule ids, so a build log could never carry the id the contract publishes and FR-011 could
// not hold. `../eslint.boundaries.js` still owns the wall — the paths, folders and word lists —
// and hands it to those six rules as flat-config `settings`.
// This plugin owns all 30 — 26 syntax-only, 4 type-aware (research R-10).

const { FAST, TYPE_AWARE, RULE_SETS } = require('./rule');

const namespace = 'ijazah';

const catalog = [
  {
    id: 'boundaries/no-cross-role-import',
    set: FAST,
    rule: require('./rules/no-cross-role-import'),
  },
  {
    id: 'boundaries/no-role-import-in-shared',
    set: FAST,
    rule: require('./rules/no-role-import-in-shared'),
  },
  {
    id: 'boundaries/no-deep-module-import',
    set: FAST,
    rule: require('./rules/no-deep-module-import'),
  },
  { id: 'boundaries/no-adapter-import', set: FAST, rule: require('./rules/no-adapter-import') },
  {
    id: 'boundaries/no-upward-admin-import',
    set: FAST,
    rule: require('./rules/no-upward-admin-import'),
  },
  { id: 'boundaries/no-money-vocabulary', set: FAST, rule: require('./rules/no-money-vocabulary') },
  { id: 'api/no-logic-in-router', set: FAST, rule: require('./rules/no-logic-in-router') },
  {
    id: 'api/no-orm-outside-repository',
    set: FAST,
    rule: require('./rules/no-orm-outside-repository'),
  },
  {
    id: 'money/no-number-in-money-position',
    set: FAST,
    rule: require('./rules/no-number-in-money-position'),
  },
  {
    id: 'time/no-datetime-outside-package',
    set: FAST,
    rule: require('./rules/no-datetime-outside-package'),
  },
  { id: 'time/no-client-timestamp', set: FAST, rule: require('./rules/no-client-timestamp') },
  {
    id: 'gender/no-authority-in-input',
    set: FAST,
    rule: require('./rules/no-authority-in-input'),
  },
  { id: 'mobile/no-raw-color', set: FAST, rule: require('./rules/no-raw-color') },
  { id: 'mobile/no-physical-direction', set: FAST, rule: require('./rules/no-physical-direction') },
  { id: 'mobile/no-raw-control', set: FAST, rule: require('./rules/no-raw-control') },
  { id: 'mobile/no-literal-string', set: FAST, rule: require('./rules/no-literal-string') },
  { id: 'mobile/no-translated-concat', set: FAST, rule: require('./rules/no-translated-concat') },
  { id: 'mobile/no-manual-format', set: FAST, rule: require('./rules/no-manual-format') },
  { id: 'mobile/no-insecure-storage', set: FAST, rule: require('./rules/no-insecure-storage') },
  { id: 'mobile/no-direct-network', set: FAST, rule: require('./rules/no-direct-network') },
  { id: 'sec/no-disabled-tls', set: FAST, rule: require('./rules/no-disabled-tls') },
  { id: 'sec/no-body-logging', set: FAST, rule: require('./rules/no-body-logging') },
  { id: 'db/no-weak-random', set: FAST, rule: require('./rules/no-weak-random') },
  {
    id: 'db/no-unfiltered-relation-read',
    set: FAST,
    rule: require('./rules/no-unfiltered-relation-read'),
  },
  { id: 'api/no-push-outside-job', set: FAST, rule: require('./rules/no-push-outside-job') },
  {
    id: 'api/require-escape-hatch-reason',
    set: FAST,
    rule: require('./rules/require-escape-hatch-reason'),
  },
  {
    id: 'proc/require-suppression-reason',
    set: FAST,
    rule: require('./rules/require-suppression-reason'),
  },
  {
    id: 'proc/no-focused-or-skipped-test',
    set: FAST,
    rule: require('./rules/no-focused-or-skipped-test'),
  },
  { id: 'proc/no-bare-marker', set: FAST, rule: require('./rules/no-bare-marker') },
  {
    id: 'money/no-arithmetic-outside-package',
    set: TYPE_AWARE,
    rule: require('./rules/no-money-arithmetic'),
  },
  {
    id: 'money/require-piaster-suffix',
    set: TYPE_AWARE,
    rule: require('./rules/require-piaster-suffix'),
  },
  {
    id: 'gender/require-requester-gender',
    set: TYPE_AWARE,
    rule: require('./rules/require-requester-gender'),
  },
  { id: 'api/table-ownership', set: TYPE_AWARE, rule: require('./rules/table-ownership') },
];

const rules = {};
const sets = Object.fromEntries(RULE_SETS.map((name) => [name, {}]));

for (const entry of catalog) {
  if (Object.hasOwn(rules, entry.id)) {
    throw new Error(`eslint-plugin-ijazah: "${entry.id}" is registered twice (R-API-9)`);
  }
  if (!Object.hasOwn(sets, entry.set)) {
    throw new Error(`eslint-plugin-ijazah: "${entry.id}" names no rule set ("${entry.set}")`);
  }
  rules[entry.id] = entry.rule;
  sets[entry.set][`${namespace}/${entry.id}`] = 'error';
}

module.exports = {
  meta: { name: 'eslint-plugin-ijazah' },
  rules,
  configs: {
    fast: { rules: sets[FAST] },
    typeAware: { rules: sets[TYPE_AWARE] },
  },
};
