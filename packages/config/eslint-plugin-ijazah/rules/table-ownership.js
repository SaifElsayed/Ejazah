// api/table-ownership  ->  R-API-6  (typeAware)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-API-6" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-API-6', constitution: 'R-API-6' },
    messages: { violation: '{{detail}} R-API-6' },
    schema: [],
  },
  create() {
    return {};
  },
};
