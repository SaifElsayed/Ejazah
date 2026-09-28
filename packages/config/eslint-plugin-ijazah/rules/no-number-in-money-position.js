// money/no-number-in-money-position  ->  R-MONEY-1  (fast)
//
// R-MONEY-1: never represent money as float or decimal. Integer piasters only. The type holds one
// direction — a plain number never becomes `Piasters` without the constructor in `packages/money`
// (FR-012, research R-3) — and this rule holds the other: a position that is declared to carry
// money and then annotated `number` has opted out of the brand, and the compiler can no longer
// catch what the annotation waved through (FR-072).
//
// WHAT IS A MONEY POSITION (T131): a declaration whose name ends in the money word — `_piasters`
// in the constitution's own `snake_case` (note under T045 and T131), and `Piasters` in camelCase,
// since the words are the same once split (`../names.js`). A parameter, a property of an
// interface, type literal or class, a variable, a function whose return type is annotated, and an
// index signature or a method are the positions a type is written at.
//
// WHAT IS PLAIN (T131): the `number` keyword or the `Number` type, at the position itself or
// anywhere inside its union, intersection, array, tuple, `readonly` or parenthesised type —
// `number | null`, `readonly number[]`, `Promise<number>` — because a nullable or listed money
// value is still money. `bigint`, `string` and `unknown` are not the brand either, but they are
// not the sidestep this rule closes: a `string` in a money position does not compile against a
// `Piasters` argument, while a `number` does the moment the brand widens. The brand type
// (`Piasters`) and any other named type are legal: this fast rule cannot resolve a name, and
// `money/require-piaster-suffix` (R-MONEY-2, type-aware) checks the type from the other side.
//
// A cast is a declaration in disguise: `price_piasters as number` and `<number>price_piasters`
// strip the brand from a value already named as money, and are refused the same way.
//
// The rule reads every file. `packages/money` declares `Piasters = number & {…}` — the intersection
// is named `Piasters`, not `*_piasters`, so it is not a money position — and `toPlainNumber(
// amount_piasters: Piasters): number` returns a number from a position typed with the brand, which
// is the one place the widening is allowed to be greppable (note under T030).
const { defineRule } = require('../rule');
const { wordsOf } = require('../names');

const MONEY_WORD = 'piasters';

function isMoneyName(name) {
  const words = wordsOf(name);
  return words.length > 0 && words[words.length - 1] === MONEY_WORD;
}

/** Whether a type node contains the plain number type anywhere a value could sit. */
function containsPlainNumber(typeNode) {
  if (typeNode === null || typeNode === undefined) return false;
  switch (typeNode.type) {
    case 'TSNumberKeyword':
      return true;
    case 'TSTypeReference':
      if (typeNode.typeName.type === 'Identifier' && typeNode.typeName.name === 'Number')
        return true;
      return (typeNode.typeArguments?.params ?? []).some(containsPlainNumber);
    case 'TSUnionType':
    case 'TSIntersectionType':
      return typeNode.types.some(containsPlainNumber);
    case 'TSArrayType':
      return containsPlainNumber(typeNode.elementType);
    case 'TSTupleType':
      return typeNode.elementTypes.some(containsPlainNumber);
    case 'TSTypeOperator': // readonly number[]
    case 'TSOptionalType':
    case 'TSRestType':
      return containsPlainNumber(typeNode.typeAnnotation);
    case 'TSNamedTupleMember':
      return containsPlainNumber(typeNode.elementType);
    case 'TSTypeAnnotation':
      return containsPlainNumber(typeNode.typeAnnotation);
    default:
      return false;
  }
}

function keyName(key, computed) {
  if (computed) return key.type === 'Literal' && typeof key.value === 'string' ? key.value : null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

/** The name a binding pattern declares, looking through a default value and an optional mark. */
function bindingName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'AssignmentPattern') return bindingName(node.left);
  if (node.type === 'TSParameterProperty') return bindingName(node.parameter);
  return null;
}

module.exports = defineRule({
  constitutionId: 'R-MONEY-1',
  description:
    'Bans typing a declared money position (a *_piasters name) as a plain number instead of the branded Piasters type',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    plainNumber:
      '"{{name}}" is a money position typed as a plain number — money is the branded Piasters type from packages/money, which a number cannot satisfy; annotating the position number opts out of the guarantee',
    strippedBrand:
      '"{{name}}" is a money value cast to a plain number — the brand is the guarantee, and a cast is the same opt-out as a number annotation',
  },
  create(context) {
    function checkAnnotated(reportNode, name, typeAnnotation) {
      if (name === null || !isMoneyName(name)) return;
      if (!containsPlainNumber(typeAnnotation)) return;
      context.report({ node: reportNode, messageId: 'plainNumber', data: { name } });
    }

    function checkParameter(parameter) {
      const target = parameter.type === 'TSParameterProperty' ? parameter.parameter : parameter;
      const name = bindingName(target);
      const annotation =
        target.type === 'AssignmentPattern' ? target.left.typeAnnotation : target.typeAnnotation;
      checkAnnotated(target, name, annotation);
    }

    function checkFunction(node) {
      for (const parameter of node.params) checkParameter(parameter);
      // A function named for money returning a number: `netPiasters(): number`.
      let name = node.id?.name ?? null;
      if (name === null && node.parent) {
        const parent = node.parent;
        if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
          name = parent.id.name;
        } else if (
          (parent.type === 'MethodDefinition' || parent.type === 'Property') &&
          parent.value === node
        ) {
          name = keyName(parent.key, parent.computed);
        }
      }
      if (node.returnType) checkAnnotated(node.returnType, name, node.returnType);
    }

    function castName(expression) {
      if (expression.type === 'Identifier') return expression.name;
      if (expression.type === 'MemberExpression') {
        return keyName(expression.property, expression.computed);
      }
      return null;
    }

    function checkCast(node) {
      const name = castName(node.expression);
      if (name === null || !isMoneyName(name)) return;
      if (!containsPlainNumber(node.typeAnnotation)) return;
      context.report({ node, messageId: 'strippedBrand', data: { name } });
    }

    return {
      TSPropertySignature: (node) => {
        checkAnnotated(node, keyName(node.key, node.computed), node.typeAnnotation);
      },
      TSMethodSignature: (node) => {
        for (const parameter of node.params) checkParameter(parameter);
        checkAnnotated(node, keyName(node.key, node.computed), node.returnType);
      },
      PropertyDefinition: (node) => {
        checkAnnotated(node, keyName(node.key, node.computed), node.typeAnnotation);
      },
      VariableDeclarator: (node) => {
        if (node.id.type !== 'Identifier') return;
        checkAnnotated(node.id, node.id.name, node.id.typeAnnotation);
      },
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      TSDeclareFunction: checkFunction,
      TSEmptyBodyFunctionExpression: checkFunction,
      TSAsExpression: checkCast,
      TSTypeAssertion: checkCast,
    };
  },
});
