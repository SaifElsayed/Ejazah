// How a type-aware rule reads the program (T044, shared by T045–T047).
//
// The four type-aware rules (research R-10) exist because a name or a shape of syntax cannot tell
// them what they need: `a - b` looks the same whatever `a` is, and `price` may or may not be money.
// Each of them asks the TypeScript program instead, and two of them ask the same question — does
// this value carry the money brand — so the answer lives here once rather than in two copies that
// could disagree about what money is.
//
// DECISION (T044) — money is recognised by the brand's declaration, not by a name. `Piasters` is
// `number & { readonly [piastersBrand]: true }` in `packages/money/src/index.ts`, and the fixture
// stub `tests/violations/fixtures/types/money-brand.d.ts` declares it the same way. A type alias's
// name is not a fact the checker keeps reliably: `Piasters` survives an import but not a
// `ReturnType<…>`, an intersection or a mapped type, while the property keyed by the private
// `unique symbol` travels with the value wherever it goes. So a type is money when it is an
// intersection of a number with an object whose property is declared under the computed key
// `[piastersBrand]`; a union of that with `null` or `undefined` (an optional or nullable amount)
// is money too. An array of amounts is not "a money value" and is not recognised here.
//
// DECISION (T044) — no `@typescript-eslint/utils`. It is not declared anywhere in the workspace
// and adding it would be a dependency no task names. `@typescript-eslint/parser` already hands a
// rule the program and the node map on `context.sourceCode.parserServices`, and `typescript` is a
// declared dependency of this package, so `requireProgram` below does what that library's
// `getParserServices` does: it refuses to run without a program, loudly and naming the rule, so a
// type-aware rule wired into the fast set fails instead of silently reporting nothing.
const ts = require('typescript');

const BRAND_KEY = 'piastersBrand';

const NULLISH = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

/**
 * The program, its checker and a way from an ESTree node to its TypeScript node, or a thrown error
 * naming the rule when the parser was not given a project.
 */
function requireProgram(context, ruleId) {
  const services = context.sourceCode.parserServices;
  const program = services?.program;
  if (program === null || program === undefined || services.esTreeNodeToTSNodeMap === undefined) {
    throw new Error(
      `eslint-plugin-ijazah (${ruleId}): this rule needs type information, but the parser was ` +
        `given no TypeScript program for "${context.filename}". Run it through the type-aware ` +
        'set (eslint.types.config.js), which points the parser at the project (research R-10).',
    );
  }
  const checker = program.getTypeChecker();
  const toTs = (node) => services.esTreeNodeToTSNodeMap.get(node);
  return {
    checker,
    toTs,
    typeOf: (node) => checker.getTypeAtLocation(toTs(node)),
  };
}

function isNullish(type) {
  return (type.flags & NULLISH) !== 0;
}

/** The constituents of a union other than `null`, `undefined` and `void`; the type itself otherwise. */
function presentConstituents(type) {
  if (!type.isUnion()) return [type];
  return type.types.filter((member) => !isNullish(member));
}

function isBrandProperty(symbol) {
  return (symbol.declarations ?? []).some(
    (declaration) =>
      declaration.name !== undefined &&
      ts.isComputedPropertyName(declaration.name) &&
      ts.isIdentifier(declaration.name.expression) &&
      declaration.name.expression.text === BRAND_KEY,
  );
}

function isBrandedIntersection(type) {
  if (!type.isIntersection()) return false;
  const numeric = type.types.some((member) => (member.flags & ts.TypeFlags.NumberLike) !== 0);
  const branded = type.types.some(
    (member) =>
      (member.flags & ts.TypeFlags.Object) !== 0 && member.getProperties().some(isBrandProperty),
  );
  return numeric && branded;
}

/** Whether a resolved type is a piaster amount, optionally nullable. */
function isMoneyType(type) {
  const present = presentConstituents(type);
  return present.length > 0 && present.every(isBrandedIntersection);
}

module.exports = { isMoneyType, presentConstituents, requireProgram };
