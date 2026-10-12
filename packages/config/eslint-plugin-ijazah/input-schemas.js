// What an input schema is, for the two rules that read one (T159): `gender/no-authority-in-input`
// (R-GENDER-4) and `time/no-client-timestamp` (R-TIME-6).
//
// An input schema is the declaration of a schema a client fills in. In `packages/contracts/src/`,
// the only shared type surface (T009), it is a variable whose name ends in `Input` or
// `InputSchema` (`bookSessionInput`, `searchTeachersInputSchema`), exported or not. Everything
// inside its initialiser belongs to it, nested objects and the arguments of `.extend()` and
// `.merge()` included. A schema the server fills in (`teacherView`) is not one, so a server-stamped
// `createdAt` or a teacher's `gender` in a response is never refused.
//
// The contracts package cannot tell which procedure kind will take a schema, a query or a
// mutation, so every input schema is held as a write schema (decided under T159): a client
// timestamp that orders a read is still a client timestamp (R-TIME-6 names ordering).
//
// WHAT IS NOT SEEN, and is review's: a schema built under another name and only later handed to a
// procedure as its input; a key computed from a value; a schema declared outside the contracts
// package (a procedure's input must come from there, R-API-7).
const { after, segmentsOf } = require('./specifiers');

const CONTRACTS = ['packages', 'contracts', 'src'];
const INPUT_NAME = /Input(?:Schema)?$/;

/** Whether `filename` is a source file of the contracts package. */
function isContractsFile(filename) {
  return after(segmentsOf(filename), CONTRACTS) !== -1;
}

/** The nearest variable declarator around `node`, when it declares an input schema; else null. */
function enclosingInput(sourceCode, node) {
  const ancestors = sourceCode.getAncestors(node);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor.type === 'VariableDeclarator') {
      return ancestor.id.type === 'Identifier' && INPUT_NAME.test(ancestor.id.name)
        ? ancestor
        : null;
    }
  }
  return null;
}

/** The nearest object-literal property around `node`, up to its declarator; else null. */
function enclosingProperty(sourceCode, node) {
  const ancestors = sourceCode.getAncestors(node);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];
    if (ancestor.type === 'Property' && ancestor.parent?.type === 'ObjectExpression') {
      return ancestor;
    }
    if (ancestor.type === 'VariableDeclarator') return null;
  }
  return null;
}

module.exports = { enclosingInput, enclosingProperty, isContractsFile };
