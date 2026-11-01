import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  isPiasters,
  lowest,
  perSession,
  piasters,
  toPlainNumber,
  type Piasters,
} from './index.js';

// `..` then `src` on purpose, so this resolves the same whether the spec runs from `src/` (root
// Vitest) or from the compiled copy in `dist/` (the package's own Vitest config).
const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

// True only when A and B are the same type. Two conditional types are mutually assignable only if
// their checked types are identical, which is what makes this stricter than assignability.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('piasters (T030, FR-012)', () => {
  it('accepts the amounts the ERD money columns actually hold', () => {
    expect(toPlainNumber(piasters(0))).toBe(0);
    expect(toPlainNumber(piasters(1))).toBe(1);
    // A plausible `packages.price_piasters`: EGP 1,500.00.
    expect(toPlainNumber(piasters(150_000))).toBe(150_000);
    expect(toPlainNumber(piasters(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a fraction, because money is integer piasters and never a decimal (R-MONEY-1)', () => {
    expect(() => piasters(1.5)).toThrow(MoneyError);
    expect(() => piasters(0.1)).toThrow(MoneyError);
    expect(() => piasters(-0.5)).toThrow(MoneyError);
  });

  it('refuses a negative amount, because no money column can go below zero (ERD §7)', () => {
    expect(() => piasters(-1)).toThrow(MoneyError);
    expect(() => piasters(Number.MIN_SAFE_INTEGER)).toThrow(MoneyError);
  });

  it('refuses NaN and both infinities', () => {
    expect(() => piasters(Number.NaN)).toThrow(MoneyError);
    expect(() => piasters(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => piasters(Number.NEGATIVE_INFINITY)).toThrow(MoneyError);
  });

  it('refuses an integer past the exact range, because the columns are wider than a JS number', () => {
    expect(() => piasters(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => piasters(1e21)).toThrow(MoneyError);
  });

  it('normalises negative zero, which the wire can produce and the database stores as zero', () => {
    const zero_piasters = piasters(-0);

    expect(Object.is(toPlainNumber(zero_piasters), 0)).toBe(true);
    expect(Object.is(toPlainNumber(zero_piasters), -0)).toBe(false);
  });

  it('names the rule and the reason it refused, and carries the offending value', () => {
    let failure: unknown;
    try {
      piasters(12.5);
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(MoneyError);
    const refusal = failure as MoneyError;
    expect(refusal.name).toBe('MoneyError');
    expect(refusal.message).toContain('R-MONEY-1');
    expect(refusal.message).toContain('not an integer');
    expect(refusal.offendingValue).toBe(12.5);
  });
});

describe('isPiasters (T030)', () => {
  it('agrees with the constructor on every case the constructor decides', () => {
    const accepted = [0, 1, 150_000, Number.MAX_SAFE_INTEGER];
    const refused = [
      1.5,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (const value of accepted) {
      expect(isPiasters(value)).toBe(true);
      expect(() => piasters(value)).not.toThrow();
    }

    for (const value of refused) {
      expect(isPiasters(value)).toBe(false);
      expect(() => piasters(value)).toThrow(MoneyError);
    }
  });

  it('narrows, so a checked number reaches a money position without a cast', () => {
    const candidate: number = 4_200;

    expect(isPiasters(candidate)).toBe(true);
    if (isPiasters(candidate)) {
      // Assignable only because the guard narrowed it; the line below the guard would not compile.
      const price_piasters: Piasters = candidate;
      expect(toPlainNumber(price_piasters)).toBe(4_200);
    }
  });
});

describe('perSession (T009, FR-337, R-212)', () => {
  it('divides a package price evenly over its sessions', () => {
    expect(toPlainNumber(perSession(piasters(120_000), 8))).toBe(15_000);
    expect(toPlainNumber(perSession(piasters(150_000), 1))).toBe(150_000);
    expect(toPlainNumber(perSession(piasters(0), 4))).toBe(0);
  });

  it('rounds a remainder below half a piaster down', () => {
    // 100 / 3 = 33.33…, 149 / 100 = 1.49.
    expect(toPlainNumber(perSession(piasters(100), 3))).toBe(33);
    expect(toPlainNumber(perSession(piasters(149), 100))).toBe(1);
  });

  it('rounds exactly half a piaster up', () => {
    // 1 / 2 = 0.5, 3 / 2 = 1.5, 150 / 100 = 1.5, 250 / 4 = 62.5: each is the tie R-212 names.
    expect(toPlainNumber(perSession(piasters(1), 2))).toBe(1);
    expect(toPlainNumber(perSession(piasters(3), 2))).toBe(2);
    expect(toPlainNumber(perSession(piasters(150), 100))).toBe(2);
    expect(toPlainNumber(perSession(piasters(250), 4))).toBe(63);
  });

  it('rounds a remainder above half a piaster up', () => {
    // 200 / 3 = 66.67, 151 / 100 = 1.51.
    expect(toPlainNumber(perSession(piasters(200), 3))).toBe(67);
    expect(toPlainNumber(perSession(piasters(151), 100))).toBe(2);
  });

  it('stays exact at the top of the safe range, where a floating division would not', () => {
    const total = Number.MAX_SAFE_INTEGER;
    for (const count of [2, 3, 7, 1_000_003]) {
      const quotient = BigInt(total) / BigInt(count);
      const remainder = BigInt(total) % BigInt(count);
      const expected = remainder * 2n >= BigInt(count) ? quotient + 1n : quotient;
      expect(BigInt(toPlainNumber(perSession(piasters(total), count)))).toBe(expected);
    }
  });

  it('returns an amount of its own brand, so it reaches a money position without a cast', () => {
    const per_session_piasters: Piasters = perSession(piasters(9_999), 4);

    expect(isPiasters(per_session_piasters)).toBe(true);
    expect(toPlainNumber(per_session_piasters)).toBe(2_500);
  });

  it('refuses a session count that is not a whole number of at least one (ERD §15 rule 36)', () => {
    for (const count of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => perSession(piasters(100), count)).toThrow(RangeError);
      expect(() => perSession(piasters(100), count)).toThrow(/perSession/);
    }
  });
});

describe('lowest (T009, FR-335, R-212)', () => {
  it('picks the lowest of the amounts, whatever their order', () => {
    expect(toPlainNumber(lowest([piasters(300), piasters(100), piasters(200)]))).toBe(100);
    expect(toPlainNumber(lowest([piasters(100), piasters(300)]))).toBe(100);
    expect(toPlainNumber(lowest([piasters(300), piasters(0)]))).toBe(0);
    expect(toPlainNumber(lowest([piasters(250), piasters(250)]))).toBe(250);
  });

  it('returns the one amount of a list of one', () => {
    expect(toPlainNumber(lowest([piasters(15_000)]))).toBe(15_000);
  });

  it('refuses an empty list, which has no lowest amount, at compile time and at run time', () => {
    // @ts-expect-error T009: an empty list is not a non-empty list of amounts.
    expect(() => lowest([])).toThrow(RangeError);

    const none: Piasters[] = [];
    expect(() => lowest(none as unknown as [Piasters])).toThrow(/lowest/);
  });
});

// The assertions below are checked by `pnpm typecheck`, not by running this file. `@ts-expect-error`
// is an assertion rather than a suppression: it fails the build when the line it guards *compiles*,
// so a refactor that exports the brand or aliases `Piasters` to `number` turns each one red instead
// of passing silently (T030, FR-012, research R-3).
describe('the brand makes a number and a piaster amount non-interchangeable (FR-012, FR-072)', () => {
  it('refuses a plain number where money is expected, in every position', () => {
    // @ts-expect-error T030/FR-012: a plain number is not assignable to Piasters.
    const from_literal_piasters: Piasters = 150_000;

    const plain: number = 150_000;
    // @ts-expect-error T030/FR-012: nor is a number-typed value, however it was obtained.
    const from_variable_piasters: Piasters = plain;

    // @ts-expect-error T030/FR-012: nor in an argument position.
    const unwrapped = toPlainNumber(150_000);

    expect([from_literal_piasters, from_variable_piasters, unwrapped]).toHaveLength(3);
  });

  it('is a distinct type from number, so aliasing it away fails the build', () => {
    const distinct: Equals<Piasters, number> = false;

    // @ts-expect-error T030/FR-012: if `Piasters` were ever `type Piasters = number`, `Equals`
    // would resolve to `true`, this line would compile, and this assertion would fail.
    const aliased: Equals<Piasters, number> = true;

    expect(distinct).toBe(false);
    // Widened on purpose: the declared type is `false`, the runtime value is `true`, and the gap
    // between them is exactly what the suppressed error above is asserting.
    expect<boolean>(aliased).toBe(true);
  });

  it('refuses a money consumer where a number consumer is expected', () => {
    // The contravariant half of FR-012: a branded intersection widens to `number` at a value
    // position by design — that is what keeps serialisation free (research R-3 rejected a wrapper
    // class for exactly this) — but a function that demands money can never stand in for one that
    // accepts any number, because that substitution would hand it an unconstructed amount.
    function consumeMoney(amount_piasters: Piasters): number {
      return toPlainNumber(amount_piasters);
    }

    // @ts-expect-error T030/FR-012: `number` is not assignable to `Piasters` in the parameter.
    const consumeNumber: (value: number) => number = consumeMoney;

    expect(consumeNumber(piasters(7))).toBe(7);
  });
});

// Exporting the brand moves nothing in the type system, so these read `index.ts` as a syntax tree.
// The tree makes them indifferent to formatting, comments and a rename of the symbol.
describe('the brand stays private to index.ts, which is the only thing holding FR-012 up', () => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  function collect<T extends ts.Node>(test: (node: ts.Node) => node is T): T[] {
    const found: T[] = [];
    const visit = (node: ts.Node): void => {
      if (test(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  }

  function isUniqueSymbolDeclaration(
    node: ts.Node,
  ): node is ts.VariableDeclaration & { name: ts.Identifier } {
    return (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.type !== undefined &&
      ts.isTypeOperatorNode(node.type) &&
      node.type.operator === ts.SyntaxKind.UniqueKeyword
    );
  }

  function theBrand(): ts.VariableDeclaration & { name: ts.Identifier } {
    const found = collect(isUniqueSymbolDeclaration);
    const [brand] = found;
    if (found.length !== 1 || brand === undefined) {
      throw new Error(
        `index.ts must declare exactly one \`unique symbol\` brand, found ${found.length}. The declaration is missing or duplicated; this is not an export.`,
      );
    }
    return brand;
  }

  function where(node: ts.Node): string {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return `line ${line + 1}: ${node.parent.getText(sourceFile)}`;
  }

  it('is declared exactly once, as a unique symbol', () => {
    expect(theBrand().name.text).not.toBe('');
  });

  it('is never exported, and never used except as a computed property key', () => {
    const declaration = theBrand();
    const brand = declaration.name.text;
    const statement = declaration.parent.parent;
    const exported = (
      ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined
    )?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

    // The one legal use is the key in `{ readonly [brand]: true }`. Any other reference — an export
    // list, `export default`, `typeof` in an exported type, an alias exported later — is a way for
    // code outside this file to mint a `Piasters` without the constructor.
    const leaks = collect(
      (node): node is ts.Identifier =>
        ts.isIdentifier(node) &&
        node.text === brand &&
        node !== declaration.name &&
        !ts.isComputedPropertyName(node.parent),
    ).map(where);
    if (exported === true) leaks.unshift(where(declaration.name));

    expect(leaks, `the brand "${brand}" escapes index.ts`).toEqual([]);
  });
});
