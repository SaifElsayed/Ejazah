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
// is money too. An array of amounts is not "a money value" and is not recognised here. The key
// is read by its identifier, `MONEY_BRAND_KEY` below, so renaming the brand in `packages/money`
// alone would switch the money rules off; the constant is exported and
// `tests/lint-plugin/no-money-arithmetic.spec.ts` asserts that `packages/money/src/index.ts`
// declares its brand under exactly that identifier, so the two can only change together (second
// review of PR #27).
//
// DECISION (T044, 2026-10-05) — a type parameter is read through its constraint. `T extends
// Piasters`, and `Row[K]` with `K extends 'gross_piasters'`, hold an amount under a type that is
// not itself the intersection, so the brand test first resolves `getBaseConstraintOfType(type) ??
// type`. Known limit, deliberately left: a union of an amount with a plain `number`
// (`Piasters | number`) is not money, because every present constituent must carry the brand.
//
// DECISION (T046, 2026-10-05) — the requester's gender is recognised by where its brand is
// declared, never by the name of its key. `RequesterGender` is the gender value of ERD §2 branded
// with a `unique symbol` in the kernel file `apps/api/src/platform/guards/requester-gender.ts`
// (T138); the checker distributes it to a union of `'male' & { … }` and `'female' & { … }`, so a
// type is the requester's gender when every constituent is an intersection of a string-like type
// with an object carrying a computed-key property declared in a file whose path ends, as a run of
// segments, in that kernel path. A brand with the same key name declared in any other file is not
// it, so it cannot be forged beside the method it is meant to guard; the specs declare theirs in
// a stub on disk at the mirrored path under `tests/` (contracts/lint-rules.md). A nullable or
// optional value is not the requester's gender either: `isRequesterGenderType` answers for the
// type as written, `null` and `undefined` included, and the rule decides what an optional one
// earns. A plain `Gender` carries no brand and is not recognised — it could be the teacher's or
// the client's, which is the whole point (R-GENDER-4). Not machine-held, by decision: a cast to
// `RequesterGender`, which review holds (contracts/lint-rules.md), and a cast to `Piasters`.
//
// DECISION (T044) — no `@typescript-eslint/utils`. It is not declared anywhere in the workspace
// and adding it would be a dependency no task names. `@typescript-eslint/parser` already hands a
// rule the program and the node maps on `context.sourceCode.parserServices`, and `typescript` is a
// declared dependency of this package, so `requireProgram` below does what that library's
// `getParserServices` does: it refuses to run without a program, loudly and naming the rule, so a
// type-aware rule wired into the fast set fails instead of silently reporting nothing.
// `tests/lint-plugin/require-program.spec.ts` asserts on that message — the rule id, the words
// "needs type information" and the name of the type-aware configuration file — so its wording is
// part of the contract and changes there before it changes here.
const ts = require('typescript');

const { segmentsOf } = require('./specifiers');

const MONEY_BRAND_KEY = 'piastersBrand';
const REQUESTER_GENDER_FILE = ['apps', 'api', 'src', 'platform', 'guards', 'requester-gender.ts'];

const NULLISH = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;

/**
 * The program's checker, whether a declaration is library code, and a way from an ESTree node to
 * its TypeScript node and back, or a thrown error naming the rule when the parser was not given a
 * project.
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
  const inDefaultLibrary = (declaration) =>
    program.isSourceFileDefaultLibrary(declaration.getSourceFile());
  return {
    checker,
    /** Whether a declaration sits in one of the standard library's `lib.*.d.ts` files. */
    inDefaultLibrary,
    /** Whether a declaration sits in the standard library or in an installed package. */
    inLibrary: (declaration) =>
      inDefaultLibrary(declaration) ||
      program.isSourceFileFromExternalLibrary(declaration.getSourceFile()),
    toTs,
    toEs: (node) => services.tsNodeToESTreeNodeMap.get(node),
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

/** Whether a declaration is a property under a computed key, the shape of a brand. */
function isComputedKey(declaration) {
  return declaration.name !== undefined && ts.isComputedPropertyName(declaration.name);
}

/** Whether a property is declared under the computed key `[piastersBrand]`, a private unique symbol. */
function isMoneyBrand(symbol) {
  return (symbol.declarations ?? []).some(
    (declaration) =>
      isComputedKey(declaration) &&
      ts.isIdentifier(declaration.name.expression) &&
      declaration.name.expression.text === MONEY_BRAND_KEY,
  );
}

/** Whether a path ends in `tail` as a run of segments. */
function endsWithSegments(filename, tail) {
  const segments = segmentsOf(filename);
  const offset = segments.length - tail.length;
  return offset >= 0 && tail.every((part, index) => segments[offset + index] === part);
}

/** Whether a property is a brand declared in the kernel's requester-gender file, whatever its key is called. */
function isRequesterGenderBrand(symbol) {
  return (symbol.declarations ?? []).some(
    (declaration) =>
      isComputedKey(declaration) &&
      endsWithSegments(declaration.getSourceFile().fileName, REQUESTER_GENDER_FILE),
  );
}

/** An intersection of a `baseFlags` type with an object carrying the brand property. */
function isBrandedIntersection(type, isBrand, baseFlags) {
  if (!type.isIntersection()) return false;
  const based = type.types.some((member) => (member.flags & baseFlags) !== 0);
  const branded = type.types.some(
    (member) => (member.flags & ts.TypeFlags.Object) !== 0 && member.getProperties().some(isBrand),
  );
  return based && branded;
}

/**
 * Whether a resolved type is a piaster amount, optionally nullable. A type parameter and an
 * indexed access are read through their constraint.
 */
function isMoneyType(type, checker) {
  const present = presentConstituents(checker.getBaseConstraintOfType(type) ?? type);
  return (
    present.length > 0 &&
    present.every((member) => isBrandedIntersection(member, isMoneyBrand, ts.TypeFlags.NumberLike))
  );
}

/** Whether a resolved type is the requester's gender itself: branded in the kernel file, not nullable. */
function isRequesterGenderType(type) {
  const members = type.isUnion() ? type.types : [type];
  return members.every((member) =>
    isBrandedIntersection(member, isRequesterGenderBrand, ts.TypeFlags.StringLike),
  );
}

module.exports = {
  MONEY_BRAND_KEY,
  isMoneyType,
  isNullish,
  isRequesterGenderType,
  presentConstituents,
  requireProgram,
};
