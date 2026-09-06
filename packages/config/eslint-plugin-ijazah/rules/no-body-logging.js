// sec/no-body-logging  ->  R-SEC-2  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-SEC-2" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-SEC-2', constitution: 'R-SEC-2' },
    messages: { violation: '{{detail}} R-SEC-2' },
    schema: [],
  },
  create() {
    return {};
  },
};
