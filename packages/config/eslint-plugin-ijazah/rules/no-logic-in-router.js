// api/no-logic-in-router  ->  R-API-1  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message ends with "R-API-1" because defineRule appends it (FR-011), so a failing
// build traces back to the prohibition. Write message text without the identifier.
const { defineRule } = require('../rule');

module.exports = defineRule({
  constitutionId: 'R-API-1',
  messages: { violation: '{{detail}}' },
  create() {
    return {};
  },
});
