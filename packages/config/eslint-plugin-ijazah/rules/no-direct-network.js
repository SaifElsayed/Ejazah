// mobile/no-direct-network  ->  R-MOBILE-11  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message ends with "R-MOBILE-11" because defineRule appends it (FR-011), so a failing
// build traces back to the prohibition. Write message text without the identifier.
const { defineRule } = require('../rule');

module.exports = defineRule({
  constitutionId: 'R-MOBILE-11',
  messages: { violation: '{{detail}}' },
  create() {
    return {};
  },
});
