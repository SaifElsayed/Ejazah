// sec/no-disabled-tls  ->  R-SEC-11  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-SEC-11" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-SEC-11', constitution: 'R-SEC-11' },
    messages: { violation: '{{detail}} R-SEC-11' },
    schema: [],
  },
  create() {
    return {};
  },
};
