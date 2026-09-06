// money/no-number-in-money-position  ->  R-MONEY-1  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MONEY-1" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MONEY-1', constitution: 'R-MONEY-1' },
    messages: { violation: '{{detail}} R-MONEY-1' },
    schema: [],
  },
  create() {
    return {};
  },
};
