// How a type-aware rule reads the program (T044, shared by T045–T047).
//
// The four type-aware rules (research R-10) exist because a name or a shape of syntax cannot tell
// them what they need: `a - b` looks the same whatever `a` is, and `price` may or may not be money.
// Each of them asks the TypeScript program instead, and three of them ask the same kind of
// question — does this value carry a brand: the money brand for T044 and T045, the requester's
// gender brand for T046 — so the answer lives here once rather than in copies that could disagree
// about what a brand is.
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
// DECISION (T046, 2026-09-28) — the requester's gender is recognised the same way. `RequesterGender`
// is `Gender & { readonly [requesterGenderBrand]: true }`, minted only by the request context
// (T106) and exported from `packages/contracts`; the checker distributes it to a union of
// `'male' & { … }` and `'female' & { … }`, so a type is the requester's gender when every present
// constituent is an intersection of a string-like type with an object branded under the computed
// key `[requesterGenderBrand]`. A plain `Gender` carries no brand and is not recognised — it could
// be the teacher's or the client's, which is the whole point (R-GENDER-4).
//
// DECISION (T044) — no `@typescript-eslint/utils`. It is not declared anywhere in the workspace
// and adding it would be a dependency no task names. `@typescript-eslint/parser` already hands a
// rule the program and the node map on `context.sourceCode.parserServices`, and `typescript` is a
// declared dependency of this package, so `requireProgram` below does what that library's
// `getParserServices` does: it refuses to run without a program, loudly and naming the rule, so a
// type-aware rule wired into the fast set fails instead of silently reporting nothing.
// `tests/lint-plugin/require-program.spec.ts` asserts on that message — the rule id, the words
// "needs type information" and the name of the type-aware configuration file — so its wording is
// part of the contract and changes there before it changes here.
const ts = require('typescript');

const MONEY_BRAND_KEY = 'piastersBrand';
const REQUESTER_GENDER_BRAND_KEY = 'requesterGenderBrand';

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

/** Whether a property is declared under the computed key `[<brandKey>]`, a private unique symbol. */
function isBrandProperty(symbol, brandKey) {
  return (symbol.declarations ?? []).some(
    (declaration) =>
      declaration.name !== undefined &&
      ts.isComputedPropertyName(declaration.name) &&
      ts.isIdentifier(declaration.name.expression) &&
      declaration.name.expression.text === brandKey,
  );
}

/** An intersection of a `baseFlags` type with an object carrying the brand property. */
function isBrandedIntersection(type, brandKey, baseFlags) {
  if (!type.isIntersection()) return false;
  const based = type.types.some((member) => (member.flags & baseFlags) !== 0);
  const branded = type.types.some(
    (member) =>
      (member.flags & ts.TypeFlags.Object) !== 0 &&
      member.getProperties().some((property) => isBrandProperty(property, brandKey)),
  );
  return based && branded;
}

/** Whether every present constituent of a type is the branded intersection; nullable allowed. */
function isBrandedType(type, brandKey, baseFlags) {
  const present = presentConstituents(type);
  return (
    present.length > 0 &&
    present.every((member) => isBrandedIntersection(member, brandKey, baseFlags))
  );
}

/** Whether a resolved type is a piaster amount, optionally nullable. */
function isMoneyType(type) {
  return isBrandedType(type, MONEY_BRAND_KEY, ts.TypeFlags.NumberLike);
}

/** Whether a resolved type is the requester's gender from the request context, optionally nullable. */
function isRequesterGenderType(type) {
  return isBrandedType(type, REQUESTER_GENDER_BRAND_KEY, ts.TypeFlags.StringLike);
}

module.exports = { isMoneyType, isRequesterGenderType, presentConstituents, requireProgram };
