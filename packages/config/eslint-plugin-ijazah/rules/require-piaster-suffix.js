// money/require-piaster-suffix  ->  R-MONEY-2  (typeAware)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MONEY-2" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MONEY-2', constitution: 'R-MONEY-2' },
    messages: { violation: '{{detail}} R-MONEY-2' },
    schema: [],
  },
  create() {
    return {};
  },
};
