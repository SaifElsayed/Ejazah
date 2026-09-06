// proc/no-bare-marker  ->  R-PROC-8  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-PROC-8" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-PROC-8', constitution: 'R-PROC-8' },
    messages: { violation: '{{detail}} R-PROC-8' },
    schema: [],
  },
  create() {
    return {};
  },
};
