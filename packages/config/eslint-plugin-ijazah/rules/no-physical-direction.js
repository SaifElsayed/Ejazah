// mobile/no-physical-direction  ->  R-MOBILE-5  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MOBILE-5" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MOBILE-5', constitution: 'R-MOBILE-5' },
    messages: { violation: '{{detail}} R-MOBILE-5' },
    schema: [],
  },
  create() {
    return {};
  },
};
