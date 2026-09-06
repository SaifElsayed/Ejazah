// gender/require-requester-gender  ->  R-GENDER-5  (typeAware)
// Placeholder. The implementing task is listed in specs/001-foundations/tasks.md.
// The message MUST end with "R-GENDER-5" so a failing build traces back to the prohibition (FR-011).
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforces R-GENDER-5', constitution: 'R-GENDER-5' },
    messages: { violation: '{{detail}} R-GENDER-5' },
    schema: [],
  },
  create() {
    return {};
  },
};
