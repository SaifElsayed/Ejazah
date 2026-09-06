// money/no-arithmetic-outside-package  ->  R-MONEY-5  (typeAware)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MONEY-5" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MONEY-5', constitution: 'R-MONEY-5' },
    messages: { violation: '{{detail}} R-MONEY-5' },
    schema: [],
  },
  create() {
    return {};
  },
};
