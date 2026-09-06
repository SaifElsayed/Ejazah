// mobile/no-raw-color  ->  R-MOBILE-4  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MOBILE-4" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MOBILE-4', constitution: 'R-MOBILE-4' },
    messages: { violation: '{{detail}} R-MOBILE-4' },
    schema: [],
  },
  create() {
    return {};
  },
};
