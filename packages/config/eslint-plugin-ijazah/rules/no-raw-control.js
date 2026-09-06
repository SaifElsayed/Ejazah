// mobile/no-raw-control  ->  R-MOBILE-6  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MOBILE-6" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MOBILE-6', constitution: 'R-MOBILE-6' },
    messages: { violation: '{{detail}} R-MOBILE-6' },
    schema: [],
  },
  create() {
    return {};
  },
};
