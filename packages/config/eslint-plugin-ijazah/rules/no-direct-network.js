// mobile/no-direct-network  ->  R-MOBILE-11  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MOBILE-11" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MOBILE-11', constitution: 'R-MOBILE-11' },
    messages: { violation: '{{detail}} R-MOBILE-11' },
    schema: [],
  },
  create() {
    return {};
  },
};
