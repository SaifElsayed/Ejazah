// Internal lint plugin (T034). Every rule is named for the constitution rule it enforces,
// and every message ends with that identifier (FR-011). Rule ids are additive-only (R-API-9).
// Mapping: specs/001-foundations/contracts/lint-rules.md

const rules = {
  'api/no-logic-in-router': require('./rules/no-logic-in-router'),
  'api/no-orm-outside-repository': require('./rules/no-orm-outside-repository'),
  'money/no-number-in-money-position': require('./rules/no-number-in-money-position'),
  'time/no-datetime-outside-package': require('./rules/no-datetime-outside-package'),
  'mobile/no-raw-color': require('./rules/no-raw-color'),
  'mobile/no-physical-direction': require('./rules/no-physical-direction'),
  'mobile/no-raw-control': require('./rules/no-raw-control'),
  'mobile/no-literal-string': require('./rules/no-literal-string'),
  'mobile/no-translated-concat': require('./rules/no-translated-concat'),
  'mobile/no-manual-format': require('./rules/no-manual-format'),
  'mobile/no-insecure-storage': require('./rules/no-insecure-storage'),
  'mobile/no-direct-network': require('./rules/no-direct-network'),
  'sec/no-disabled-tls': require('./rules/no-disabled-tls'),
  'sec/no-body-logging': require('./rules/no-body-logging'),
  'db/no-weak-random': require('./rules/no-weak-random'),
  'api/no-push-outside-job': require('./rules/no-push-outside-job'),
  'api/require-escape-hatch-reason': require('./rules/require-escape-hatch-reason'),
  'proc/require-suppression-reason': require('./rules/require-suppression-reason'),
  'proc/no-focused-or-skipped-test': require('./rules/no-focused-or-skipped-test'),
  'proc/no-bare-marker': require('./rules/no-bare-marker'),
  'money/no-arithmetic-outside-package': require('./rules/no-money-arithmetic'),
  'money/require-piaster-suffix': require('./rules/require-piaster-suffix'),
  'gender/require-requester-gender': require('./rules/require-requester-gender'),
  'api/table-ownership': require('./rules/table-ownership'),
};

const fast = {};
const typeAware = {};
fast['ijazah/api/no-logic-in-router'] = 'error';
fast['ijazah/api/no-orm-outside-repository'] = 'error';
fast['ijazah/money/no-number-in-money-position'] = 'error';
fast['ijazah/time/no-datetime-outside-package'] = 'error';
fast['ijazah/mobile/no-raw-color'] = 'error';
fast['ijazah/mobile/no-physical-direction'] = 'error';
fast['ijazah/mobile/no-raw-control'] = 'error';
fast['ijazah/mobile/no-literal-string'] = 'error';
fast['ijazah/mobile/no-translated-concat'] = 'error';
fast['ijazah/mobile/no-manual-format'] = 'error';
fast['ijazah/mobile/no-insecure-storage'] = 'error';
fast['ijazah/mobile/no-direct-network'] = 'error';
fast['ijazah/sec/no-disabled-tls'] = 'error';
fast['ijazah/sec/no-body-logging'] = 'error';
fast['ijazah/db/no-weak-random'] = 'error';
fast['ijazah/api/no-push-outside-job'] = 'error';
fast['ijazah/api/require-escape-hatch-reason'] = 'error';
fast['ijazah/proc/require-suppression-reason'] = 'error';
fast['ijazah/proc/no-focused-or-skipped-test'] = 'error';
fast['ijazah/proc/no-bare-marker'] = 'error';
typeAware['ijazah/money/no-arithmetic-outside-package'] = 'error';
typeAware['ijazah/money/require-piaster-suffix'] = 'error';
typeAware['ijazah/gender/require-requester-gender'] = 'error';
typeAware['ijazah/api/table-ownership'] = 'error';

module.exports = {
  meta: { name: 'eslint-plugin-ijazah' },
  rules,
  configs: {
    fast: { rules: fast },
    typeAware: { rules: typeAware },
  },
};
