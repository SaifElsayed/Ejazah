// gender/require-requester-gender  ->  R-GENDER-5  (typeAware)
//
// R-GENDER-5: never create a repository method that returns teachers without taking the
// requester's gender; there must be no unfiltered method to call from a student-facing path
// (FR-005, ADR 0006). The same-gender predicate lives once, in catalog's repository (SRS §3.7.1),
// and a method that never receives the requester's gender cannot apply it. A filtered and an
// unfiltered method are syntactically identical, so this rule decides from what the program says
// the method returns and what its parameters are (research R-10), never from a query in the body:
// the R-GENDER-5 fixture has no query on purpose (note under T025–T026 about T046).
//
// DECISION (T046) — which files and which methods. Files named `*.repository.*` (the extension is
// dropped first, as `api/no-orm-outside-repository` does). A repository method is an exported
// function — a declaration, `export default function`, or an exported `const` bound to an arrow or
// function expression — or a class method that is not `private` and not `#private`.
//
// DECISION (T046) — "returns teachers" is a type-level fact. The resolved return type is unwrapped
// through `Promise`, arrays, readonly arrays, tuples, intersections and unions with `null` or
// `undefined`; any object type left whose declared symbol name — interface, type alias, class or
// generated model type — contains `Teacher` is a teacher. It is resolved through the checker, so
// `type TeacherList = readonly TeacherCard[]` or a return type the compiler infers still count.
// This is deliberately wide: a `TeacherSubject` or `TeacherSignature` row is teacher data too, and
// a teacher-side caller can always pass its own gender. A raw generated payload type that carries
// no such name (an un-annotated `findMany` result) is not recognised; repositories return named
// types, and the first catalog repository task is where that is checked against the real client.
//
// DECISION (T046) — "takes the requester's gender" is a type-level fact too. Some parameter, or
// some property of an object-typed parameter (one level, so `{ requesterGender, subjectId }` in an
// options object counts), resolves to the gender type: a type whose symbol or alias name is
// `Gender`, or exactly the literal union `'male' | 'female'`, which is what Prisma emits for
// `enum Gender` in `prisma/schema/base.prisma`. Parameter names are not consulted, so renaming a
// parameter can neither satisfy nor break the rule. A parameter carrying the teacher's gender
// rather than the requester's would also satisfy it; that is a review question, not designed for.
const path = require('node:path');

const ts = require('typescript');

const { defineRule } = require('../rule');
const { presentConstituents, requireProgram } = require('../types');

const RULE_ID = 'gender/require-requester-gender';

const TEACHER = /Teacher/;
const GENDER_NAME = 'Gender';
const GENDER_VALUES = ['female', 'male'];

function isRepositoryFile(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  const basename = path.basename(filename);
  const withoutExtension = basename.slice(0, basename.length - path.extname(basename).length);
  return withoutExtension.toLowerCase().endsWith('.repository');
}

function declaredNames(type) {
  return [type.aliasSymbol?.name, type.getSymbol()?.name].filter((name) => name !== undefined);
}

/** The name of the teacher type a return type delivers, or null. */
function teacherIn(checker, type, seen = new Set()) {
  if (seen.has(type)) return null;
  seen.add(type);

  for (const member of presentConstituents(type)) {
    if ((member.flags & ts.TypeFlags.Object) !== 0) {
      const named = declaredNames(member).find((name) => TEACHER.test(name));
      if (named !== undefined) return named;
    }

    const inner = [];
    const awaited = checker.getAwaitedType(member);
    if (awaited !== undefined && awaited !== member) inner.push(awaited);
    if (checker.isArrayType(member) || checker.isTupleType(member)) {
      inner.push(...checker.getTypeArguments(member));
    }
    if (member.isIntersection()) inner.push(...member.types);

    for (const candidate of inner) {
      const found = teacherIn(checker, candidate, seen);
      if (found !== null) return found;
    }
  }
  return null;
}

function isGenderType(type) {
  if (declaredNames(type).includes(GENDER_NAME)) return true;
  const present = presentConstituents(type);
  if (present.some((member) => declaredNames(member).includes(GENDER_NAME))) return true;
  const values = present.map((member) => (member.isStringLiteral() ? member.value : null));
  return (
    values.length === GENDER_VALUES.length &&
    [...values].sort().every((value, index) => value === GENDER_VALUES[index])
  );
}

function takesGender(checker, signature) {
  return signature.getParameters().some((parameter) => {
    const type = checker.getTypeOfSymbol(parameter);
    if (isGenderType(type)) return true;
    const options = checker.getNonNullableType(type);
    if ((options.flags & ts.TypeFlags.Object) === 0 && !options.isIntersection()) return false;
    return checker
      .getPropertiesOfType(options)
      .some((property) => isGenderType(checker.getTypeOfSymbol(property)));
  });
}

module.exports = defineRule({
  constitutionId: 'R-GENDER-5',
  description: "Requires the requester's gender on every repository method returning teachers",
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    missingGender:
      "Repository method '{{name}}' returns {{teacher}} but takes no requester gender, so a caller cannot apply the same-gender predicate (SRS §3.7.1). Take the requester's Gender as a parameter or an options property.",
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);
    if (!isRepositoryFile(context.filename)) return {};
    const { checker } = program;

    function check(functionNode, reportNode, name) {
      const declaration = program.toTs(functionNode);
      const signature =
        declaration === undefined ? undefined : checker.getSignatureFromDeclaration(declaration);
      if (signature === undefined) return;
      const teacher = teacherIn(checker, checker.getReturnTypeOfSignature(signature));
      if (teacher === null || takesGender(checker, signature)) return;
      context.report({ node: reportNode, messageId: 'missingGender', data: { name, teacher } });
    }

    function checkExportedFunction(node) {
      check(node, node.id ?? node, node.id?.name ?? 'default');
    }

    return {
      'ExportNamedDeclaration > FunctionDeclaration': checkExportedFunction,
      'ExportNamedDeclaration > TSDeclareFunction': checkExportedFunction,
      'ExportDefaultDeclaration > FunctionDeclaration': checkExportedFunction,
      'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator'(node) {
        const { init } = node;
        if (init === null || node.id.type !== 'Identifier') return;
        if (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression') return;
        check(init, node.id, node.id.name);
      },
      MethodDefinition(node) {
        if (node.kind !== 'method' || node.accessibility === 'private') return;
        if (node.key.type === 'PrivateIdentifier') return;
        const name =
          node.key.type === 'Identifier' && !node.computed
            ? node.key.name
            : context.sourceCode.getText(node.key);
        check(node, node.key, name);
      },
    };
  },
});
