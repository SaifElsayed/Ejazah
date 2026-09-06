// api/require-escape-hatch-reason  ->  R-API-10  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-API-10" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-API-10', constitution: 'R-API-10' },
    messages: { violation: '{{detail}} R-API-10' },
    schema: [],
  },
  create() {
    return {};
  },
};
