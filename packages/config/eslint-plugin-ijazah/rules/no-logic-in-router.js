// api/no-logic-in-router  ->  R-API-1  (fast)
//
// R-API-1: never put business logic in a tRPC procedure. Validate, call one service method,
// return. The mechanism the constitution names is a complexity ceiling on `*.router.ts`, because
// a business rule cannot be recognised by its syntax — but it cannot be written without deciding
// something either, and decisions are countable (FR-071).
//
// DECISION (T036) — the ceiling is 5, measured as cyclomatic complexity per function.
//
// A thin procedure is a straight line: it takes the validated input, calls one service method and
// returns what came back. That is complexity 1. The decisions a procedure may honestly still need
// are the ones about the request rather than about the domain — a nullish default on an optional
// input, a narrow guard translating a domain error into a response, a cursor present or absent —
// and three of those is already a generous allowance for a file whose job is to dispatch. Five
// leaves room for them and no room for a rule: the fixture in
// `tests/violations/fixtures/apps/api/src/surfaces/booking.router.ts` carries more than twenty
// decisions in one procedure, which is what a business rule looks like once it is written in the
// wrong file, and every value a reviewer would defend refuses it.
//
// The number is a spec decision, not a preference: raising it is how R-API-1 quietly stops
// meaning anything, so a change belongs in `specs/001-foundations/` and in review, not in a
// commit that needed one more branch today. The ceiling is exposed as the `max` option so a
// later task can tune it from `packages/config/eslint.base.js` — one place, visible in the
// configuration a reviewer reads — rather than by editing this rule.
//
// Decisions counted, following the standard cyclomatic definition: `if` (an `else if` is another
// `if`, so it counts itself), the ternary, each short-circuiting `&&`, `||` and `??` including
// their assignment forms, every loop, every `case` carrying a test (`default` decides nothing),
// every `catch`, and a default value on a parameter or a destructured property, which the header
// above already names as one of the decisions a thin procedure may honestly make. Optional
// chaining is not counted: `a?.b` guards a value, it does not carry a rule.
//
// WHAT IS MEASURED (T036, review of PR #20): every function on its own — a nested callback's
// decisions belong to the callback, not to its host — and also the file's own top level and each
// class static block, which are bodies that run and can decide exactly like a function body. A
// six-way `if / else if` chain written outside any function is the same business rule in the same
// wrong file, and counting only what sits inside a `function` keyword was an accident of how the
// walk was written, not a rule anyone would defend. Each body's count starts at 1, for the single
// path through a body that decides nothing.
//
// The file is matched by its basename, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/`, so a rule comparing
// a root-relative path would see none of them (note under T035).
const path = require('node:path');

const { defineRule } = require('../rule');

// A thin procedure validates, calls one service method and returns. See the header for why 5.
const DEFAULT_MAX = 5;

const SHORT_CIRCUIT = new Set(['&&', '||', '??', '&&=', '||=', '??=']);

function isRouterFile(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  const basename = path.basename(filename);
  const withoutExtension = basename.slice(0, basename.length - path.extname(basename).length);
  return withoutExtension.toLowerCase().endsWith('.router');
}

// The name a reviewer would use for the body in the message. A procedure is normally a property
// or a method of the router object, so those two come before the function's own id.
function bodyName(node) {
  if (node.type === 'Program') return "the file's top level";
  if (node.type === 'StaticBlock') return 'a static block';
  if (node.id && node.id.name) return node.id.name;

  const parent = node.parent;
  if (!parent) return 'an anonymous function';

  if (
    (parent.type === 'Property' ||
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    parent.value === node
  ) {
    const key = parent.key;
    if (key.type === 'Identifier') return key.name;
    if (key.type === 'Literal') return String(key.value);
  }
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }
  return 'an anonymous function';
}

module.exports = defineRule({
  constitutionId: 'R-API-1',
  description: 'Holds every function in a *.router.ts file under a cyclomatic complexity ceiling',
  schema: [
    {
      type: 'object',
      properties: {
        max: {
          type: 'integer',
          minimum: 1,
        },
      },
      additionalProperties: false,
    },
  ],
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    tooComplex:
      '"{{name}}" makes {{complexity}} decisions, over the ceiling of {{max}} — a request procedure validates its input, calls one service method and returns, so a rule this size belongs in the service',
  },
  create(context) {
    if (!isRouterFile(context.filename)) return {};

    // The schema above is what validates this; ESLint refuses the configuration before the rule
    // ever runs, so a second check here would only be a second place to keep in step.
    const max = context.options[0]?.max ?? DEFAULT_MAX;

    // One entry per body currently being walked — the file's top level, a function, a static
    // block. A nested body counts on its own.
    const stack = [];

    // `Program` frames the file, so there is always a body to charge the decision to.
    function decide() {
      stack[stack.length - 1].complexity += 1;
    }

    function enter(node) {
      stack.push({ node, complexity: 1 });
    }

    function leave() {
      const frame = stack.pop();
      if (frame === undefined || frame.complexity <= max) return;
      context.report({
        node: frame.node.id ?? frame.node,
        messageId: 'tooComplex',
        data: {
          name: bodyName(frame.node),
          complexity: String(frame.complexity),
          max: String(max),
        },
      });
    }

    return {
      Program: enter,
      'Program:exit': leave,
      StaticBlock: enter,
      'StaticBlock:exit': leave,
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': leave,
      FunctionExpression: enter,
      'FunctionExpression:exit': leave,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': leave,

      IfStatement: decide,
      ConditionalExpression: decide,
      ForStatement: decide,
      ForInStatement: decide,
      ForOfStatement: decide,
      WhileStatement: decide,
      DoWhileStatement: decide,
      CatchClause: decide,
      // `function p({ cursor = null })` — a default is a decision about the request.
      AssignmentPattern: decide,
      SwitchCase: (node) => {
        // `default` chooses nothing; it is where control lands when nothing was chosen.
        if (node.test !== null) decide();
      },
      LogicalExpression: (node) => {
        if (SHORT_CIRCUIT.has(node.operator)) decide();
      },
      AssignmentExpression: (node) => {
        if (SHORT_CIRCUIT.has(node.operator)) decide();
      },
    };
  },
});
