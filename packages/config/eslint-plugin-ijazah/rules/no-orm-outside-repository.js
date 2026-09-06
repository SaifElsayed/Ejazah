// api/no-orm-outside-repository  ->  R-API-2  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-API-2" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-API-2', constitution: 'R-API-2' },
    messages: { violation: '{{detail}} R-API-2' },
    schema: [],
  },
  create() {
    return {};
  },
};
