// api/table-ownership  ->  R-API-6  (typeAware)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message ends with "R-API-6" because defineRule appends it (FR-011), so a failing
// build traces back to the prohibition. Write message text without the identifier.
const { defineRule } = require('../rule');

module.exports = defineRule({
  constitutionId: 'R-API-6',
  messages: { violation: '{{detail}}' },
  create() {
    return {};
  },
});
