// proc/no-focused-or-skipped-test  ->  R-PROC-10  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-PROC-10" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-PROC-10', constitution: 'R-PROC-10' },
    messages: { violation: '{{detail}} R-PROC-10' },
    schema: [],
  },
  create() {
    return {};
  },
};
