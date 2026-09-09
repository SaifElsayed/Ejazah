// The internal lint plugin (T034). Every rule is named for the constitution rule it enforces,
// and every message ends with that identifier (FR-011) — appended by `./rule.js`, never typed by
// hand. Rule ids are additive-only (R-API-9).
// Mapping: specs/001-foundations/contracts/lint-rules.md
//
// The catalog below is the plugin's single source of truth. `rules`, `configs.fast.rules` and
// `configs.typeAware.rules` are all derived from it, so a rule cannot be registered under one id
// and configured under another, cannot be registered and left unconfigured, and cannot land in
// both sets. Three hand-kept lists could drift; one table cannot disagree with itself.
//
// The six `boundaries/*` ids the contract publishes are not here: they are configuration of
// `eslint-plugin-boundaries` in `../eslint.boundaries.js` (T035), not rules of this plugin.
// This plugin owns the other 24 — 20 syntax-only, 4 type-aware (research R-10).

const { FAST, TYPE_AWARE, RULE_SETS } = require('./rule');

const namespace = 'ijazah';

const catalog = [
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
