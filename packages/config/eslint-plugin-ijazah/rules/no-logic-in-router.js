// api/no-logic-in-router  ->  R-API-1  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-API-1" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-API-1', constitution: 'R-API-1' },
    messages: { violation: '{{detail}} R-API-1' },
    schema: [],
  },
  create() {
    return {};
  },
};
