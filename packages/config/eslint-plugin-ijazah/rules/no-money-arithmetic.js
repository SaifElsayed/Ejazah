// money/no-arithmetic-outside-package  ->  R-MONEY-5  (typeAware)
//
// R-MONEY-5: never do money arithmetic outside `packages/money`. No `+`, `-`, `*` on piaster
// values in feature code (FR-013). Under ADR 0007 the domain has no money arithmetic at all — a
// teacher sets a price and the gateway reports gross, fee and net as numbers it computed — so an
// operator applied to an amount anywhere else is either a share, a remainder or a "net = gross -
// fee" the platform must never compute. `a - b` reads the same whatever `a` and `b` are, which is
// why this rule asks the program what each operand is (research R-10) instead of reading names.
//
// DECISION (T044) — what counts as arithmetic. The contract row says "any arithmetic operand
// carrying the money brand", and the operator can be spelled four ways that are the same
// prohibition: a binary `+ - * / % ** & | ^ << >> >>>`, a compound assignment `+= -= *= /= %= **=
// &= |= ^= <<= >>= >>>=`, a unary `-`, `+` or `~`, and an update `++` or `--`. All four are
// refused. Bitwise and shift operators are arithmetic here (revised 2026-09-28): `price_piasters
// >> 1` halves an amount, `| 0` and `~~x` truncate one, so they compute a new amount exactly as
// `/ 2` and `Math.trunc` would and R-MONEY-5 owns them. Comparisons (`< > <= >= === !==`) are not
// arithmetic and stay legal: in the R-MONEY-5 fixture, `gross_piasters - fee_piasters > 0` is
// refused for the `-`, never for the `>`. A `+` with a string on the other side is refused too,
// because R-MONEY-5 bans `+` on a piaster value whatever it produces; an amount reaches text
// through `toPlainNumber` or a formatter.
//
// DECISION (T044) — one report per expression, naming the first operand that carries the brand,
// so `a_piasters - b_piasters` is one problem and not two. A chain `a + b + c` is two expressions
// and reports twice, once per operator, which is where the fix has to happen.
//
// DECISION (T044) — the brand, not the name, decides. "Carries the brand" is `isMoneyType` in
// `../types.js`, shared with `money/require-piaster-suffix` (T045): the branded intersection
// `number & { readonly [piastersBrand]: true }`, recognised by the declaration of its unique-symbol
// key rather than by the alias name `Piasters`, optionally unioned with `null` or `undefined`. A
// type parameter is read through its constraint (2026-10-05), so `a - b` with `T extends Piasters`
// and `row[key] * 2` with `K extends 'gross_piasters'` are refused.
//
// DECISION (T044, 2026-10-05) — known limits, recorded so that none of them reads as an oversight
// (reviews of PR #27); `tests/lint-plugin/no-money-arithmetic.spec.ts` pins each as a valid case.
// The brand is an intersection with `number`, so an amount widens to a plain number without a
// word from the compiler, and once it has, this rule has nothing left to recognise:
// `(price_piasters as number) * 2`, `Number(price_piasters) * 2`, an amount assigned to a
// `number` and then multiplied, and an amount inside a template literal are all silent.
// `toPlainNumber` is the one greppable place that widening is meant to happen (note under T030).
// Two things are not arithmetic and are legal by decision rather than by omission:
// `Math.max(a_piasters, b_piasters)`, a call that picks one of its arguments, and a template
// literal, which has no operator — although `'EGP ' + price_piasters` is refused, because that
// one is the `+` R-MONEY-5 names. And a `Piasters | number` union is not money, because every
// present constituent must carry the brand (`../types.js`).
//
// Files under `packages/money/` are exempt: that package is the one place R-MONEY-5 allows the
// operation. The path is read as a run of segments through `segmentsOf`/`after` in
// `../specifiers.js`, which handles Windows separators and the fixture tree alike (note under
// T035). Known limit of that reading: the run `packages/money` exempts a file wherever it appears
// in a path, so a folder of that name inside an application (`features/teacher/packages/money/`)
// would be exempt too. No such folder exists; the reviewer of the pull request that adds one
// holds it.
const { defineRule } = require('../rule');
const { after, segmentsOf } = require('../specifiers');
const { isMoneyType, requireProgram } = require('../types');

const RULE_ID = 'money/no-arithmetic-outside-package';

const MONEY_PACKAGE = ['packages', 'money'];

const BINARY = new Set(['+', '-', '*', '/', '%', '**', '&', '|', '^', '<<', '>>', '>>>']);
const COMPOUND = new Set([
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
  '>>>=',
]);
const UNARY = new Set(['-', '+', '~']);

function insideMoneyPackage(filename) {
  return after(segmentsOf(filename), MONEY_PACKAGE) !== -1;
}

module.exports = defineRule({
  constitutionId: 'R-MONEY-5',
  description: 'Bans arithmetic on a piaster value outside packages/money',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    arithmetic:
      "'{{operand}}' is a piaster amount used with '{{operator}}' outside packages/money. Money arithmetic lives only in that package; show an amount through toPlainNumber or a formatter.",
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);
    if (insideMoneyPackage(context.filename)) return {};

    function check(node, operator, operands) {
      const money = operands.find((operand) =>
        isMoneyType(program.typeOf(operand), program.checker),
      );
      if (money === undefined) return;
      context.report({
        node,
        messageId: 'arithmetic',
        data: { operand: context.sourceCode.getText(money), operator },
      });
    }

    return {
      BinaryExpression(node) {
        if (BINARY.has(node.operator)) check(node, node.operator, [node.left, node.right]);
      },
      AssignmentExpression(node) {
        if (COMPOUND.has(node.operator)) check(node, node.operator, [node.left, node.right]);
      },
      UnaryExpression(node) {
        if (UNARY.has(node.operator)) check(node, node.operator, [node.argument]);
      },
      UpdateExpression(node) {
        check(node, node.operator, [node.argument]);
      },
    };
  },
});
