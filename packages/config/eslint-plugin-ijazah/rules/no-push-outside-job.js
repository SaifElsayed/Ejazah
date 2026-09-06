// api/no-push-outside-job  ->  R-API-15  (fast)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-API-15" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-API-15', constitution: 'R-API-15' },
    messages: { violation: '{{detail}} R-API-15' },
    schema: [],
  },
  create() {
    return {};
  },
};
