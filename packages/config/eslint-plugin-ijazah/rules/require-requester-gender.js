// gender/require-requester-gender  ->  R-GENDER-5  (typeAware)
//
// R-GENDER-5: never create a repository method that returns teachers without taking the
// requester's gender; there must be no unfiltered method to call from a student-facing path
// (FR-005, ADR 0006). The same-gender predicate lives once, in catalog's repository (SRS §3.7.1),
// and a method that never receives the requester's gender cannot apply it. A filtered and an
// unfiltered method are syntactically identical, so this rule decides from what the program says
// the method returns and what its parameters are (research R-10), never from a query in the body:
// the R-GENDER-5 fixture has no query on purpose (note under T025–T026 about T046). The contract
// row and its notes in `specs/001-foundations/contracts/lint-rules.md` are the authority for
// every decision below.
//
// DECISION (T046, 2026-10-05) — which files and which methods. Files named
// `<name>.repository.<extension>` (the extension is dropped first, as
// `api/no-orm-outside-repository` does). A repository method is any function such a file exposes
// to another file, whatever the form of the export, so it is read from the module's exports
// through the checker and never from the syntax of one export form: an exported function or
// declared overload, a function bound to an exported name (`export const f = () => …`,
// `export { f }`, `export { f as g }`), a default export of either kind, and the members of an
// exported object, class or class instance — methods, properties holding a function (a class
// property arrow), abstract methods, static methods and getters. A getter takes no parameter, so
// one that returns teachers is always refused. A function that is not exported stays legal: a
// private row mapper is not callable from a student-facing path. So do `private` and `#private`
// class members. Deliberately left: members are read one level down (a function inside an object
// inside an exported object is not), and only members declared in the file itself, so the
// methods of an exported array or `Map` are not mistaken for repository methods.
//
// DECISION (T046, 2026-10-05) — "returns teachers" is a type-level fact, read exactly as the
// contract's second note defines it. An object type whose name carries `Teacher` appears in the
// resolved return type either directly or one property step down, through a property of an object
// type, named or unnamed (`{ items: TeacherCard[]; nextCursor }`, `interface SearchResult`).
// Promises, arrays, tuples, unions, intersections and the type arguments of a generic type — an
// alias's too, so `Page<TeacherCard>`, `Pick<TeacherCard, 'id'>`, `Map<string, TeacherCard>` and
// `Record<string, TeacherCard>` count — are unwrapped before and after that step and are not a
// step themselves. Only the name of an object type, or of an intersection whose members are all
// object types (`type TeacherView = UserRow & { bio: string }`), is read, from the alias symbol
// as well as the symbol; an intersection with a primitive, such as a branded `TeacherId`, is not,
// and neither is an enum such as `TeacherStatus`, so an id or a status does not make the row that
// carries it a teacher. This is deliberately wide: a `TeacherSubject` or `TeacherSignature` row is
// teacher data, and so is any module's row carrying a teacher-typed property. Held by review, not
// by this rule (R-GENDER-5's second mechanism): a teacher more than one property step down or
// behind an index signature, and a teacher returned under a type whose name does not carry
// `Teacher` (the condition under T055 closes the generated payload case).
//
// DECISION (T046, 2026-10-05) — "takes the requester's gender" is a type-level fact too. The
// signature must have a required parameter, or a required property of a required options
// parameter, that is not nullable and whose type is `RequesterGender`: the gender value branded
// in the kernel file `apps/api/src/platform/guards/requester-gender.ts` (T138), which only the
// request context may mint in production code (T106). The brand is recognised by where it is
// declared, through `isRequesterGenderType` in `../types.js`, never by the name of its key, so a
// brand of the same name declared anywhere else is refused. An optional or nullable one is
// refused under a message of its own, because a call that leaves it out still compiles and that
// call is the unfiltered method. A plain `Gender` — the alias, or the literal union
// `'male' | 'female'` Prisma emits for `enum Gender` — is refused under its own message as well:
// it could be the teacher's gender or a value the client sent (R-GENDER-4). Parameter names are
// never consulted. The rule accepts `RequesterGender` and nothing else, so a teacher-returning
// method for an administrator, a background job or a public caller cannot be written yet; the
// first task that needs one adds its own type to the contract row (first note under the
// type-aware table). A cast to `RequesterGender` is not seen here and is held by review.
const path = require('node:path');

const ts = require('typescript');

const { defineRule } = require('../rule');
const {
  isNullish,
  isRequesterGenderType,
  presentConstituents,
  requireProgram,
} = require('../types');

const RULE_ID = 'gender/require-requester-gender';

const TEACHER = /Teacher/;
const GENDER_NAME = 'Gender';
const GENDER_VALUES = ['female', 'male'];

// What a signature's parameters carry, strongest first: the requester's gender, required; the
// requester's gender where a caller may leave it out; a plain gender that satisfies nothing but
// earns the more specific message; or no gender at all.
const REQUESTER = 'requester';
const OPTIONAL = 'optional';
const PLAIN = 'plain';
const NONE = 'none';
const STRENGTH = [NONE, PLAIN, OPTIONAL, REQUESTER];

const MESSAGE_FOR = {
  [NONE]: 'missingGender',
  [PLAIN]: 'plainGender',
  [OPTIONAL]: 'optionalGender',
};

function isRepositoryFile(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  const basename = path.basename(filename);
  const withoutExtension = basename.slice(0, basename.length - path.extname(basename).length);
  return withoutExtension.toLowerCase().endsWith('.repository');
}

function isObjectType(type) {
  return (type.flags & ts.TypeFlags.Object) !== 0;
}

function declaredNames(type) {
  return [type.aliasSymbol?.name, type.getSymbol()?.name].filter((name) => name !== undefined);
}

/** The names the contract reads: an object type's, or an all-object intersection's. */
function readableNames(type) {
  const readable = isObjectType(type) || (type.isIntersection() && type.types.every(isObjectType));
  return readable ? declaredNames(type) : [];
}

/**
 * Every type reached from `type` without a property step: through unions, intersections,
 * promises, arrays, tuples and the type arguments of a generic type or alias.
 */
function unwrap(checker, type, reached = new Set()) {
  if (reached.has(type)) return reached;
  reached.add(type);

  const inner = [];
  if (type.isUnionOrIntersection()) inner.push(...type.types);
  if (type.aliasTypeArguments !== undefined) inner.push(...type.aliasTypeArguments);
  if (isObjectType(type) && (type.objectFlags & ts.ObjectFlags.Reference) !== 0) {
    inner.push(...checker.getTypeArguments(type));
  }
  const awaited = checker.getAwaitedType(type);
  if (awaited !== undefined && awaited !== type) inner.push(awaited);

  for (const candidate of inner) unwrap(checker, candidate, reached);
  return reached;
}

function teacherNamed(types) {
  for (const type of types) {
    const named = readableNames(type).find((name) => TEACHER.test(name));
    if (named !== undefined) return named;
  }
  return null;
}

/** The name of the teacher type a return type delivers, directly or one property step down, or null. */
function teacherIn(checker, type) {
  const direct = unwrap(checker, type);
  const found = teacherNamed(direct);
  if (found !== null) return found;

  for (const holder of direct) {
    // An array or a tuple was unwrapped through its elements; its own members are the library's.
    if (!isObjectType(holder) || checker.isArrayType(holder) || checker.isTupleType(holder)) {
      continue;
    }
    for (const property of checker.getPropertiesOfType(holder)) {
      const below = teacherNamed(unwrap(checker, checker.getTypeOfSymbol(property)));
      if (below !== null) return below;
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

function isNullable(type) {
  return isNullish(type) || (type.isUnion() && type.types.some(isNullish));
}

/** What one value carries, given whether a caller is free to leave it out. */
function genderKind(checker, type, required) {
  if (isRequesterGenderType(type)) return required ? REQUESTER : OPTIONAL;
  if (isNullable(type) && isRequesterGenderType(checker.getNonNullableType(type))) return OPTIONAL;
  return isGenderType(type) ? PLAIN : NONE;
}

function stronger(left, right) {
  return STRENGTH.indexOf(left) >= STRENGTH.indexOf(right) ? left : right;
}

function isRequiredParameter(checker, parameter) {
  const declaration = parameter.valueDeclaration;
  if (declaration === undefined || !ts.isParameter(declaration)) return false;
  return declaration.dotDotDotToken === undefined && !checker.isOptionalParameter(declaration);
}

/** What one parameter carries: itself, or the properties of the options object it is. */
function parameterKind(checker, parameter) {
  const type = checker.getTypeOfSymbol(parameter);
  const required = isRequiredParameter(checker, parameter);
  let kind = genderKind(checker, type, required);

  const options = checker.getNonNullableType(type);
  if (kind !== NONE || options.isUnion() || !(isObjectType(options) || options.isIntersection())) {
    return kind;
  }
  const requiredOptions = required && !isNullable(type);
  for (const property of checker.getPropertiesOfType(options)) {
    const requiredProperty = requiredOptions && (property.flags & ts.SymbolFlags.Optional) === 0;
    kind = stronger(kind, genderKind(checker, checker.getTypeOfSymbol(property), requiredProperty));
  }
  return kind;
}

function genderTaken(checker, signature) {
  return signature
    .getParameters()
    .reduce((taken, parameter) => stronger(taken, parameterKind(checker, parameter)), NONE);
}

function isHidden(declaration) {
  if (declaration.name !== undefined && ts.isPrivateIdentifier(declaration.name)) return true;
  return (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Private) !== 0;
}

module.exports = defineRule({
  constitutionId: 'R-GENDER-5',
  description: "Requires the requester's gender on every repository method returning teachers",
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    missingGender:
      "Repository method '{{name}}' returns {{teacher}} but takes no requester gender, so a caller cannot apply the same-gender predicate (SRS §3.7.1). Take RequesterGender, the type branded in apps/api/src/platform/guards/requester-gender.ts, as a required parameter or a required property of a required options parameter; a brand of the same name declared anywhere else is not it.",
    plainGender:
      "Repository method '{{name}}' returns {{teacher}} but its gender parameter is a plain Gender, which could be the teacher's or a value the client sent (R-GENDER-4). The parameter must be RequesterGender, the type branded in apps/api/src/platform/guards/requester-gender.ts, which only the request context mints.",
    optionalGender:
      "Repository method '{{name}}' returns {{teacher}} and takes RequesterGender only as an optional or nullable value, so a call that leaves it out still compiles and is the unfiltered method. Make it a required, non-nullable parameter, or a required property of a required options parameter.",
  },
  create(context) {
    const program = requireProgram(context, RULE_ID);
    if (!isRepositoryFile(context.filename)) return {};
    const { checker } = program;
    const reported = new Set();

    return {
      Program(programNode) {
        const sourceFile = program.toTs(programNode);
        // A file with no import or export is a script: it has no module symbol and exposes nothing.
        const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
        if (moduleSymbol === undefined) return;

        const inThisFile = (node) => node !== undefined && node.getSourceFile() === sourceFile;

        /** The first candidate that sits in this file and has an ESTree node, or the file itself. */
        function reportNode(candidates) {
          for (const candidate of candidates) {
            const node = inThisFile(candidate) ? program.toEs(candidate) : undefined;
            if (node !== undefined) return node;
          }
          return programNode;
        }

        function report(key, node, name, teacher, taken) {
          if (taken === REQUESTER || reported.has(key)) return;
          reported.add(key);
          context.report({ node, messageId: MESSAGE_FOR[taken], data: { name, teacher } });
        }

        function checkSignatures(type, name, anchors) {
          for (const signature of type.getCallSignatures()) {
            const teacher = teacherIn(checker, checker.getReturnTypeOfSignature(signature));
            if (teacher === null) continue;
            const declaration = signature.getDeclaration();
            const ownName = declaration?.name;
            report(
              declaration ?? signature,
              reportNode([ownName, ...anchors, declaration]),
              ownName !== undefined && ts.isIdentifier(ownName) ? ownName.text : name,
              teacher,
              genderTaken(checker, signature),
            );
          }
        }

        /** The members of an exported object, class or instance that this file declares. */
        function checkMembers(type) {
          for (const member of checker.getPropertiesOfType(type)) {
            const declarations = (member.declarations ?? []).filter(inThisFile);
            if (declarations.length === 0 || declarations.some(isHidden)) continue;
            const memberType = checker.getTypeOfSymbol(member);
            const anchors = declarations.map((declaration) => declaration.name);

            if (memberType.getCallSignatures().length > 0) {
              checkSignatures(memberType, member.name, anchors);
              continue;
            }
            const getter = declarations.find(ts.isGetAccessor);
            if (getter === undefined) continue;
            const teacher = teacherIn(checker, memberType);
            if (teacher !== null) {
              report(getter, reportNode([getter.name]), member.name, teacher, NONE);
            }
          }
        }

        for (const exported of checker.getExportsOfModule(moduleSymbol)) {
          const symbol =
            (exported.flags & ts.SymbolFlags.Alias) !== 0
              ? checker.getAliasedSymbol(exported)
              : exported;
          if ((symbol.flags & ts.SymbolFlags.Value) === 0) continue;

          // Where a report lands when the function itself is declared in another file.
          const exportSite = (exported.declarations ?? []).map(
            (declaration) => declaration.name ?? declaration,
          );
          const type = checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
          const declaredName = symbol.name === 'default' ? exported.name : symbol.name;

          if ((symbol.flags & ts.SymbolFlags.Class) !== 0) {
            checkMembers(checker.getDeclaredTypeOfSymbol(symbol));
            checkMembers(type);
          } else if (type.getCallSignatures().length > 0) {
            checkSignatures(type, declaredName, [symbol.valueDeclaration?.name, ...exportSite]);
          } else {
            checkMembers(type);
          }
        }
      },
    };
  },
});
