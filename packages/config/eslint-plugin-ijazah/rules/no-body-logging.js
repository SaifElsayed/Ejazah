// sec/no-body-logging  ->  R-SEC-2  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message ends with "R-SEC-2" because defineRule appends it (FR-011), so a failing
// build traces back to the prohibition. Write message text without the identifier.
const { defineRule } = require('../rule');

module.exports = defineRule({
  constitutionId: 'R-SEC-2',
  messages: { violation: '{{detail}}' },
  create() {
    return {};
  },
});
