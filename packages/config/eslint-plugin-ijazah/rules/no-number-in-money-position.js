// money/no-number-in-money-position  ->  R-MONEY-1  (fast)
//
// R-MONEY-1: never represent money as float or decimal. Integer piasters only. The guarantee is
// the `Piasters` brand in `packages/money`: a plain number cannot be passed where money is
// expected (FR-012). The compiler holds that only where a position is typed with the brand, so a
// position annotated `number` sidesteps it and takes whatever arrives — a float, a pound amount,
// an unvalidated input. This rule refuses the annotation the compiler can no longer object to
// (FR-072).
//
// A MONEY POSITION is a declared name whose last word is `piasters`: the suffix R-MONEY-2 requires
// and the ERD gives every money column (`price_piasters`, `snapshot_price_piasters`,
// `gross_piasters`, `gateway_fee_piasters`, `net_piasters`). The constitution's spelling is
// snake_case (note under T045 and T131); `pricePiasters` and `PRICE_PIASTERS` are the same words
// and are read the same way, so a camelCase name is not a way round the rule. The word is the
// suffix, not a part of the name: `piastersPerPound` and `piastersToPounds()` are not amounts.
//
// WHAT IS REFUSED — a money position whose type is a plain number:
//
//   where        a parameter (default, rest and constructor parameter property included), a
//                variable, an interface or type-literal member, a class property or accessor, a
//                setter's parameter, and the return type of a function, method, getter or declared
//                function carrying a money name;
//                the type-level forms too: the parameters of a function type, a constructor type,
//                a call or construct signature and a method signature, and a method signature's
//                return type.
//   which types  `number`, alone or in a union (`number | null`); the boxed `Number`; a `Decimal`
//                (`Prisma.Decimal` included), which R-MONEY-1 names beside float;
//                and any of them inside `T[]`, `readonly T[]`, a tuple, `Array`, `ReadonlyArray`,
//                `Set`, `ReadonlySet`, `Iterable`, `Promise`, `Readonly`, `NonNullable`,
//                `Awaited`, the value of `Record`, `Map` and `ReadonlyMap`, and the return of a
//                function type written at the position (`price_piasters: () => number`).
//   a cast       `as number` or `<number>` (any of the types above) where the value cast is a
//                money name (`price_piasters as number`, `row.net_piasters as number`, through
//                optional chaining, `!` and an inner cast), or where the result lands in a money
//                position: a money-named variable, object property, class property, default or
//                assignment target, directly or through a conditional, `||`, `&&` or `??`.
//                A branded value leaves the brand through `toPlainNumber()` and a number enters it
//                through `piasters()`; a cast is neither.
//
// `packages/money` is exempt: it is where a plain number becomes money and back (the constructor,
// the guard and the unwrap), which is the one place the constitution puts that.
//
// WHAT IS NOT SEEN, and why.
//
//   - A money value under a name without the suffix (`price: number`). The name is the only thing
//     a syntax rule can read; R-MONEY-2 (`money/require-piaster-suffix`, type-aware) owns names,
//     and it reads the type, so a `number` under a plain name is seen by neither rule. Review.
//   - An inferred number: `const price_piasters = Number(input)` has no annotation and no cast.
//     The compiler refuses it at the first branded position it is handed to.
//   - `bigint`. It is neither float nor decimal; whether an amount may travel as one is not this
//     rule's question.
//   - A type alias or a generic standing for number (`type Amount = number`), an intersection, a
//     mapped or conditional type. Resolving those needs the program (research R-10).
//   - A Zod schema. `z.number()` at a money key in `packages/contracts` declares a plain number
//     at run time and is not read here: it is a call, not a type annotation. Open for the
//     contracts work (note under T131).
const { defineRule } = require('../rule');
const { after, segmentsOf } = require('../specifiers');
const { keyName, propertyName, unwrap } = require('../syntax');
const { wordsOf } = require('../words');

const MONEY_PACKAGE = ['packages', 'money'];
const SUFFIX_WORDS = new Set(['piasters', 'piaster']);

// Type references that are a plain number themselves.
const PLAIN_NAMES = new Set(['Number', 'Decimal']);
// Generic types that hold what every type argument says.
const HOLDERS = new Set([
  'Array',
  'ReadonlyArray',
  'Set',
  'ReadonlySet',
  'Iterable',
  'AsyncIterable',
  'Promise',
  'PromiseLike',
  'Readonly',
  'NonNullable',
  'Awaited',
]);
// Generic types whose last type argument is the value they hold.
const KEYED_HOLDERS = new Set(['Record', 'Map', 'ReadonlyMap']);

// Expressions that hand their operand on unchanged, for climbing from a cast to where it lands.
const PASS_THROUGH = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
]);

function isMoneyName(name) {
  if (typeof name !== 'string') return false;
  const last = wordsOf(name).at(-1);
  return last !== undefined && SUFFIX_WORDS.has(last);
}

function referenceName(reference) {
  const { typeName } = reference;
  if (typeName.type === 'Identifier') return typeName.name;
  if (typeName.type === 'TSQualifiedName') return typeName.right.name;
  return null;
}

/** True when the type is a plain number, or holds one where the header says a number hides. */
function carriesPlainNumber(typeNode) {
  const pending = [typeNode];
  while (pending.length > 0) {
    const type = pending.pop();
    if (type === null || type === undefined) continue;

    switch (type.type) {
      case 'TSNumberKeyword':
        return true;
      case 'TSUnionType':
        pending.push(...type.types);
        break;
      case 'TSArrayType':
        pending.push(type.elementType);
        break;
      case 'TSTypeOperator':
        if (type.operator === 'readonly') pending.push(type.typeAnnotation);
        break;
      case 'TSTupleType':
        pending.push(...type.elementTypes);
        break;
      case 'TSNamedTupleMember':
        pending.push(type.elementType);
        break;
      case 'TSOptionalType':
      case 'TSRestType':
        pending.push(type.typeAnnotation);
        break;
      case 'TSFunctionType':
        pending.push(type.returnType?.typeAnnotation);
        break;
      case 'TSTypeReference': {
        const name = referenceName(type);
        if (name === null) break;
        if (PLAIN_NAMES.has(name)) return true;
        const held = type.typeArguments?.params ?? [];
        if (HOLDERS.has(name)) pending.push(...held);
        else if (KEYED_HOLDERS.has(name)) pending.push(held.at(-1));
        break;
      }
      default:
        break;
    }
  }
  return false;
}

/** The name a function is declared or held under, or null. */
function functionName(node) {
  if (node.id !== null && node.id !== undefined) return node.id.name;
  const { parent } = node;
  if (parent === null || parent === undefined) return null;
  switch (parent.type) {
    case 'VariableDeclarator':
      return parent.init === node && parent.id.type === 'Identifier' ? parent.id.name : null;
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
    case 'TSAbstractMethodDefinition':
      return parent.value === node ? keyName(parent) : null;
    default:
      return null;
  }
}

/** The name a value is, when it is an identifier or a member access: `x`, `row.x`, `row?.['x']!`. */
function valueName(node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return null;
  if (inner.type === 'Identifier') return inner.name;
  if (inner.type === 'MemberExpression') return propertyName(inner);
  return null;
}

/** The name of the position a cast's result lands in, climbing wrappers and choices, or null. */
function landingName(cast) {
  let current = cast;
  for (;;) {
    const { parent } = current;
    if (parent === null || parent === undefined) return null;

    if (PASS_THROUGH.has(parent.type) && parent.expression === current) {
      current = parent;
    } else if (parent.type === 'ConditionalExpression' && parent.test !== current) {
      current = parent;
    } else if (parent.type === 'LogicalExpression') {
      current = parent;
    } else if (parent.type === 'VariableDeclarator') {
      return parent.init === current && parent.id.type === 'Identifier' ? parent.id.name : null;
    } else if (parent.type === 'Property') {
      const inObject = parent.parent.type === 'ObjectExpression';
      return inObject && parent.value === current ? keyName(parent) : null;
    } else if (parent.type === 'PropertyDefinition' || parent.type === 'AccessorProperty') {
      return parent.value === current ? keyName(parent) : null;
    } else if (parent.type === 'AssignmentExpression' || parent.type === 'AssignmentPattern') {
      return parent.right === current ? valueName(parent.left) : null;
    } else {
      return null;
    }
  }
}

module.exports = defineRule({
  constitutionId: 'R-MONEY-1',
  description: 'Bans a plain number type at a declared money position outside packages/money',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    plainNumber:
      '"{{name}}" is a money position typed as a plain number — type it Piasters from packages/money, because the brand is what keeps a float or an unvalidated number out of an amount',
    plainNumberReturned:
      '"{{name}}" returns money typed as a plain number — return Piasters from packages/money, because the brand is what keeps a float or an unvalidated number out of an amount',
    castToNumber:
      '"{{name}}" is money and is cast to a plain number — build an amount with piasters() and unwrap one with toPlainNumber(), because a cast does neither and removes the brand without a trace',
  },
  create(context) {
    if (after(segmentsOf(context.filename), MONEY_PACKAGE) !== -1) return {};

    function checkPosition(node, name, annotation) {
      if (annotation === null || annotation === undefined) return;
      if (!isMoneyName(name) || !carriesPlainNumber(annotation.typeAnnotation)) return;
      context.report({ node, messageId: 'plainNumber', data: { name } });
    }

    function checkReturn(node, name) {
      const { returnType } = node;
      if (returnType === null || returnType === undefined) return;
      if (!isMoneyName(name) || !carriesPlainNumber(returnType.typeAnnotation)) return;
      context.report({ node: returnType, messageId: 'plainNumberReturned', data: { name } });
    }

    function checkFunction(node) {
      checkReturn(node, functionName(node));
      // `set price_piasters(value: number)`: the setter's name is the position.
      const { parent } = node;
      if (parent.type !== 'MethodDefinition' || parent.kind !== 'set') return;
      const [parameter] = node.params;
      if (parameter !== undefined && parameter.type === 'Identifier') {
        checkPosition(parameter, keyName(parent), parameter.typeAnnotation);
      }
    }

    function checkMember(node) {
      checkPosition(node.key, keyName(node), node.typeAnnotation);
    }

    function checkCast(node) {
      if (!carriesPlainNumber(node.typeAnnotation)) return;
      const cast = valueName(node.expression);
      const name = isMoneyName(cast) ? cast : landingName(node);
      if (isMoneyName(name)) context.report({ node, messageId: 'castToNumber', data: { name } });
    }

    return {
      // Every binding that carries its own annotation: a parameter of any function or signature,
      // a parameter property, a parameter with a default, a variable.
      Identifier(node) {
        checkPosition(node, node.name, node.typeAnnotation);
      },
      RestElement(node) {
        if (node.argument.type === 'Identifier') {
          checkPosition(node.argument, node.argument.name, node.typeAnnotation);
        }
      },
      TSPropertySignature: checkMember,
      PropertyDefinition: checkMember,
      AccessorProperty: checkMember,
      TSAbstractPropertyDefinition: checkMember,
      TSAbstractAccessorProperty: checkMember,
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      TSDeclareFunction: checkFunction,
      TSEmptyBodyFunctionExpression: checkFunction,
      TSMethodSignature(node) {
        checkReturn(node, keyName(node));
      },
      TSAsExpression: checkCast,
      TSTypeAssertion: checkCast,
    };
  },
});
