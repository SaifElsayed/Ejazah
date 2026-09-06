// proc/require-suppression-reason  ->  R-PROC-7  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-PROC-7" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-PROC-7', constitution: 'R-PROC-7' },
    messages: { violation: '{{detail}} R-PROC-7' },
    schema: [],
  },
  create() {
    return {};
  },
};
