// mobile/no-manual-format  ->  R-MOBILE-9  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-MOBILE-9" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-MOBILE-9', constitution: 'R-MOBILE-9' },
    messages: { violation: '{{detail}} R-MOBILE-9' },
    schema: [],
  },
  create() {
    return {};
  },
};
