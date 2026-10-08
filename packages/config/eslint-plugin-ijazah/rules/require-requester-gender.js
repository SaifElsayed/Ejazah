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
// `api/no-orm-outside-repository` does), with a name in front: since the second review of PR #27
// a file named exactly `.repository.ts` is not one. A repository method is any function such a
// file exposes to another file, whatever the form of the export, so it is read from the module's
// exports through the checker and never from the syntax of one export form: an exported function
// or declared overload, a function bound to an exported name (`export const f = () => …`,
// `export { f }`, `export { f as g }`), a default export of either kind, a re-export
// (`export { f } from`, `export * from`, `export * as ns from`), and the members of an exported
// object, class or class instance — methods, properties holding a function (a class property
// arrow), abstract methods, static methods and getters. A getter takes no parameter, so one that
// returns teachers is always refused. A function that is not exported stays legal: a private row
// mapper is not callable from a student-facing path.
//
// DECISION (T046, 2026-10-05, second review of PR #27) — members are read wherever they are
// declared, except in a library. A member declared in this file, in a base class in another file,
// in an imported interface that types an export or on an imported object is a repository method all
// the same; a member every declaration of which sits in the standard library or an installed
// package is not, so the methods of an exported array or `Map` are not mistaken for repository
// methods. A report lands on the member's own name when this file declares it, on the exported name
// otherwise. A class exposed as a value (`export const R = class { … }`, `export const R = Impl`, a
// mixin `Traced(Impl)`) is read through the instances its construct signatures build. A callable
// export has its members read too (a function merged with a namespace). An exported function's
// result, after a promise is unwrapped, is read one level as an exported object is: a function it
// returns (`() => (): TeacherCard[] => []`) and the members of the object or instance it returns (a
// factory). Those returned methods are judged by their own parameters, so a factory that takes the
// requester's gender and returns methods that do not is refused: it fails closed, and the method
// should take the gender itself. The same holds for a returned teacher whose own method returns a
// teacher (a gender-taking finder returning `TeacherView` with `withBio(): TeacherView`, or
// `Page<TeacherCard>` with `next()`): that method takes no gender and is refused, which fails
// closed too and costs nothing for a Prisma row, which carries no methods. `private` and
// `#private` members are skipped, because nothing outside the class can call them; a `protected`
// member is read and refused like a public one, because a subclass can expose it (fails closed).
// Deliberately left: members are read one level down, so a function inside an object inside an
// exported object is not.
//
// DECISION (T046, 2026-10-05) — "returns teachers" is a type-level fact, read exactly as the
// contract's second note defines it. An object type whose name carries `Teacher` appears in the
// resolved return type either directly or one property step down, through a property of an object
// type, named or unnamed (`{ items: TeacherCard[]; nextCursor }`, `interface SearchResult`).
// Promises, arrays, tuples, unions, intersections and the type arguments of a generic type — an
// alias's too, so `Page<TeacherCard>`, `Pick<TeacherCard, 'id'>`, `Map<string, TeacherCard>` and
// `Record<string, TeacherCard>` count — are unwrapped before and after that step and are not a
// step themselves, and so is the constraint of a type parameter or an indexed access, so
// `list<T extends TeacherCard>(): Promise<T[]>` returns teachers. Only the name of an object
// type, or of an intersection whose members are all object types
// (`type TeacherView = UserRow & { bio: string }`), is read, from the alias symbol as well as the
// symbol; an intersection with a primitive, such as a branded `TeacherId`, is not, and neither
// is an enum such as `TeacherStatus`, so an id or a status does not make the row that carries it
// a teacher. This is deliberately wide: a `TeacherSubject` or `TeacherSignature` row is
// teacher data, and so is any module's row carrying a teacher-typed property. Held by review, not
// by this rule (R-GENDER-5's second mechanism): a teacher more than one property step down or
// behind an index signature, and a teacher returned under a type whose name does not carry
// `Teacher` and that is built from no teacher type (the condition under T055 closes the generated
// payload case, DECISION (T152) below the mapped-type case).
//
// DECISION (T152, PR #47 review n1, 2026-10-08) — a mapped type is read through the types it was
// built from. `type Card = Pick<TeacherProfile, 'id'>` takes the alias name `Card` and loses the
// type arguments of `Pick`, so the unwrapping above never reached `TeacherProfile`; the same held
// for `Omit` and for a key-mapped `{ [K in 'id' | 'bio']: TeacherProfile[K] }`, over the generated
// model and over a plain `Teacher…` interface alike. A mapped type's sources are now read like the
// type itself, by name or by model: the arguments of its instantiation, through the checker's
// unpublished `mapper` as for a payload (TypeScript is pinned at 5.9.3, and the cases fail if it
// moves), and the object type of its template when the template is an indexed access. A source
// is unwrapped, never stepped into, so a settings payload, whose instantiation carries the
// client's type map, is still not a teacher.
//
// DECISION (T102, the condition under T055, 2026-10-08) — the generated client's payloads. Prisma
// resolves a model's row type — `TeacherProfile` itself, `Prisma.TeacherProfileGetPayload<…>`, and
// the type a `findUnique({ select })` returns, annotated or inferred — to an anonymous mapped type
// declared in its runtime, which carries no name at all: the name test above never sees
// `TeacherProfile`, even where the code writes it. Such a type is read as the model it was built
// from, the `$<Model>Payload` type the generated client declares, found in one of two places: the
// type arguments its instantiation was made with (a `select` row, whose properties are synthetic),
// or the declarations of its properties (a full row's are declared in that payload type). The
// first is read through the checker's `mapper`, which the TypeScript API does not publish;
// TypeScript is pinned, and the RuleTester cases of this condition fail if it moves. A payload of a
// model whose name carries `Teacher` is a teacher, reported under the model's name; a payload of
// any other model, such as a settings row, is not. Only a type declared inside the generated
// client (`@prisma/client` or `.prisma/client`) is read this way.
//
// DECISION (T102, 2026-10-08) — the database client is not teacher data. The client carries a
// delegate per model (`teacherProfile: TeacherProfileDelegate`), so one property step down it
// would read as teachers, and `platform/db/prisma.repository.ts`, which T036 made a repository
// file so it may name the client, would be refused for returning it. A type carrying a `$` member
// declared in the generated client (the client, a transaction client, an extended client) is
// therefore not stepped into through the members the client declares. Teacher rows are still
// caught where they are read: in the repository of the module that owns the table (R-API-6),
// whose methods return what the delegate returns. Handing the client itself to another file is
// R-API-2's and R-API-6's, not this rule's.
//
// DECISION (T152, PR #47 review n3, 2026-10-08) — the exemption covers the client's own
// declarations only. A class that extends `PrismaClient` inherits its `$` members, so until T152 it
// was exempt whole, and a teacher property it added was never read. Now a member of a client type
// is skipped only when every one of its declarations sits in the generated client; any other
// member — a subclass's property, an intersection's, an extension's `client` member — is read like
// a property of any object, and a member with no declaration is read too, which fails closed. The
// one client of `prisma.repository.ts`, extended by T148, stays exempt by this test: its delegates
// are the client's declarations, and its `includeDeleted` member is itself a client, not a teacher.
//
// DECISION (T046, 2026-10-05) — "takes the requester's gender" is a type-level fact too. The
// signature must have a required parameter, or a required property of a required options parameter,
// that is not nullable and whose type is `RequesterGender`: the gender value branded in the kernel
// file `apps/api/src/platform/guards/requester-gender.ts` (T138), which only the request context
// may mint in production code (T106). The brand is recognised by where it is declared, through
// `isRequesterGenderType` in `../types.js`, never by the name of its key, so a brand of the same
// name declared anywhere else is refused. An optional or nullable one is refused under a message of
// its own, because a call that leaves it out still compiles and that call is the unfiltered method.
// A rest parameter is never required, so a gender inside a rest tuple (`...args: [who:
// RequesterGender, id: string]`) is refused as optional too, though the tuple makes it required:
// the rule fails closed, and the fix is a plain parameter. A plain `Gender` — the alias, or the
// literal union `'male' | 'female'` Prisma emits for `enum Gender` — is refused under its own
// message as well: it could be the teacher's gender or a value the client sent (R-GENDER-4).
// Parameter names are never consulted. The rule accepts `RequesterGender` and nothing else, so a
// teacher-returning method for an administrator, a background job or a public caller cannot be
// written yet; the first task that needs one adds its own type to the contract row (first note
// under the type-aware table). A cast to `RequesterGender` is not seen here and is held by review.
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

const REPOSITORY_SUFFIX = '.repository';

/** `<name>.repository.<extension>` with a name in front: `.repository.ts` alone is not one. */
function isRepositoryFile(filename) {
  if (typeof filename !== 'string' || filename === '') return false;
  const basename = path.basename(filename);
  const withoutExtension = basename.slice(0, basename.length - path.extname(basename).length);
  return (
    withoutExtension.toLowerCase().endsWith(REPOSITORY_SUFFIX) &&
    withoutExtension.length > REPOSITORY_SUFFIX.length
  );
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
 * promises, arrays, tuples, the type arguments of a generic type or alias, and the constraint of
 * a type parameter or an indexed access.
 */
function unwrap(checker, type, reached = new Set()) {
  if (reached.has(type)) return reached;
  reached.add(type);

  const inner = [];
  const constraint = checker.getBaseConstraintOfType(type);
  if (constraint !== undefined && constraint !== type) inner.push(constraint);
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

// The generated client's files: the package and the output it generates beside it.
const CLIENT_FILE = /(^|\/)(@prisma\/client|\.prisma\/client)\//;
// The payload type the generated client declares for each model: `$TeacherProfilePayload`.
const PAYLOAD = /^\$(\w+)Payload$/;
// How far a chain of the checker's mappers is followed; a composite mapper holds two at each level.
const MAPPER_DEPTH = 8;

function inClient(declaration) {
  return CLIENT_FILE.test(declaration.getSourceFile().fileName.split(path.sep).join('/'));
}

/** The model a `$<Model>Payload` alias of the generated client names, or null. */
function payloadModelOf(symbol) {
  const match = symbol === undefined ? null : PAYLOAD.exec(symbol.name);
  if (match === null || !(symbol.declarations ?? []).some(inClient)) return null;
  return match[1];
}

/** The types an instantiation was made with, read from the checker's (unpublished) mapper. */
function mapperTargets(mapper, depth = 0, found = []) {
  if (mapper === undefined || mapper === null || depth > MAPPER_DEPTH) return found;
  const targets = [mapper.target, ...(Array.isArray(mapper.targets) ? mapper.targets : [])];
  for (const target of targets) {
    if (target !== null && typeof target === 'object' && typeof target.flags === 'number') {
      found.push(target);
    }
  }
  mapperTargets(mapper.mapper1, depth + 1, found);
  mapperTargets(mapper.mapper2, depth + 1, found);
  return found;
}

/** The model of the payload alias a property was declared in, walking up from its declaration. */
function declaringPayload(declaration) {
  for (let node = declaration; node !== undefined; node = node.parent) {
    if (ts.isTypeAliasDeclaration(node)) {
      const match = PAYLOAD.exec(node.name.text);
      return match !== null && inClient(node) ? match[1] : null;
    }
  }
  return null;
}

/** The model a row type of the generated client was built from, or null. */
function generatedModel(type) {
  if (!isObjectType(type) || !(type.getSymbol()?.declarations ?? []).some(inClient)) return null;
  for (const target of mapperTargets(type.mapper)) {
    const model = payloadModelOf(target.aliasSymbol);
    if (model !== null) return model;
  }
  for (const property of type.getProperties()) {
    for (const declaration of property.declarations ?? []) {
      const model = declaringPayload(declaration);
      if (model !== null) return model;
    }
  }
  return null;
}

/** The database client, or a transaction or extended client: it carries a `$` member of the client. */
function isDatabaseClient(type) {
  return type
    .getProperties()
    .some(
      (property) => property.name.startsWith('$') && (property.declarations ?? []).some(inClient),
    );
}

/**
 * A member the generated client declares itself, such as a model delegate, an extended client's
 * included (DECISION (T152)). A member with no declaration is read, which fails closed.
 */
function clientOwn(property) {
  const declarations = property.declarations ?? [];
  return declarations.length > 0 && declarations.every(inClient);
}

/**
 * The types a mapped type was built from (DECISION (T152)): the arguments of its instantiation,
 * `TeacherProfile` in `Pick<TeacherProfile, 'id'>`, read through the checker's mapper as for a
 * payload; and the object of its template's indexed access, `TeacherProfile` in
 * `{ [K in 'id']: TeacherProfile[K] }`.
 */
function mappedSources(checker, type) {
  if (!isObjectType(type) || (type.objectFlags & ts.ObjectFlags.Mapped) === 0) return [];
  const sources = mapperTargets(type.mapper);
  for (const declaration of type.getSymbol()?.declarations ?? []) {
    if (!ts.isMappedTypeNode(declaration) || declaration.type === undefined) continue;
    const template = checker.getTypeFromTypeNode(declaration.type);
    if ((template.flags & ts.TypeFlags.IndexedAccess) !== 0) sources.push(template.objectType);
  }
  return sources;
}

function teacherNamed(checker, types, seen = new Set()) {
  for (const type of types) {
    if (seen.has(type)) continue;
    seen.add(type);
    const named = readableNames(type).find((name) => TEACHER.test(name));
    if (named !== undefined) return named;
    const model = generatedModel(type);
    if (model !== null && TEACHER.test(model)) return model;
    const sources = mappedSources(checker, type).flatMap((source) => [...unwrap(checker, source)]);
    const fromSource = teacherNamed(checker, sources, seen);
    if (fromSource !== null) return fromSource;
  }
  return null;
}

/** The name of the teacher type a return type delivers, directly or one property step down, or null. */
function teacherIn(checker, type) {
  const direct = unwrap(checker, type);
  const found = teacherNamed(checker, direct);
  if (found !== null) return found;

  for (const holder of direct) {
    // An array or a tuple was unwrapped through its elements; its own members are the library's.
    if (!isObjectType(holder) || checker.isArrayType(holder) || checker.isTupleType(holder)) {
      continue;
    }
    // The client's delegates are accessors, not rows (DECISION (T102) above); a member added to
    // the client is read like any other (DECISION (T152)).
    const client = isDatabaseClient(holder);
    for (const property of checker.getPropertiesOfType(holder)) {
      if (client && clientOwn(property)) continue;
      const below = teacherNamed(checker, unwrap(checker, checker.getTypeOfSymbol(property)));
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

        /** Whether a member is library code throughout: an array's, a `Map`'s, a package's. */
        const fromLibrary = (declarations) => declarations.every(program.inLibrary);

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

        /**
         * The members of an exported object, class or instance, wherever they are declared outside
         * a library: in this file, in a base class, in an imported interface or object. A report
         * lands on the member's own name when this file declares it, on the export otherwise.
         */
        function checkMembers(type, exportSite) {
          for (const member of checker.getPropertiesOfType(type)) {
            const declarations = member.declarations ?? [];
            if (declarations.length === 0 || fromLibrary(declarations)) continue;
            if (declarations.some(isHidden)) continue;
            const memberType = checker.getTypeOfSymbol(member);
            const anchors = [...declarations.map((declaration) => declaration.name), ...exportSite];

            if (memberType.getCallSignatures().length > 0) {
              checkSignatures(memberType, member.name, anchors);
              continue;
            }
            const getter = declarations.find(ts.isGetAccessor);
            if (getter === undefined) continue;
            const teacher = teacherIn(checker, memberType);
            if (teacher !== null) {
              report(getter, reportNode(anchors), member.name, teacher, NONE);
            }
          }
        }

        /** The instances a class exposed as a value builds: a class expression, alias or mixin. */
        function checkInstances(type, exportSite) {
          for (const signature of type.getConstructSignatures()) {
            checkMembers(checker.getReturnTypeOfSignature(signature), exportSite);
          }
        }

        /**
         * What an exported function hands back, read one level as an exported object is: a
         * function it returns (the curried form) and the members of the object or instance it
         * returns (the factory form). Library code is not read, so a function returning a list or
         * a promise of one is not mistaken for a factory.
         */
        function checkReturned(type, name, exportSite) {
          for (const signature of type.getCallSignatures()) {
            const result = checker.getReturnTypeOfSignature(signature);
            const returned = checker.getNonNullableType(checker.getAwaitedType(result) ?? result);
            const ownCalls = returned.getCallSignatures().some((inner) => {
              const declaration = inner.getDeclaration();
              return declaration === undefined || !program.inLibrary(declaration);
            });
            if (ownCalls) checkSignatures(returned, name, exportSite);
            checkMembers(returned, exportSite);
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
            checkMembers(checker.getDeclaredTypeOfSymbol(symbol), exportSite);
          } else {
            checkInstances(type, exportSite);
          }
          if (type.getCallSignatures().length > 0) {
            const anchors = [symbol.valueDeclaration?.name, ...exportSite];
            checkSignatures(type, declaredName, anchors);
            checkReturned(type, declaredName, anchors);
          }
          checkMembers(type, exportSite);
        }
      },
    };
  },
});
