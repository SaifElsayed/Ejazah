// db/no-unfiltered-relation-read  ->  R-DB-3  (fast)
//
// R-DB-3: never hard-delete users, sessions, enrollments or ijazahs; removal is `deleted_at`, and
// a soft-deleted row is excluded from every ordinary read, count and facet (ERD §0). A query on one
// table reaches those rows through a relation without naming their table, so "every ordinary read"
// holds only if the relation itself excludes them (research R-116; ADR 0011 deferred the rule to
// the first repository that reads a relation, which is this phase's).
//
// WHAT IS READ. Every `*.repository.ts` file (the only files that write a query, R-API-2). A call
// `<delegate>.<method>({ … })` whose method is a Prisma query or write that returns rows
// (`findMany`, `findFirst`, `findFirstOrThrow`, `findUnique`, `findUniqueOrThrow`, `create`,
// `createManyAndReturn`, `update`, `updateManyAndReturn`, `upsert`, `delete`), and in its argument
// the `include` and `select` objects, at any depth. The delegate's model is the member name before
// the method (`tx.enrollment.findMany` is `Enrollment`); a delegate held in a variable has no name,
// and a relation is then judged by its name alone when every model that has a relation of that
// name agrees on where it leads.
//
// The models, their relations and which models carry `deletedAt` are read from `prisma/schema/`
// at lint time (`prisma-schema.js`), so a new soft-deletable model is covered with no edit here.
//
// WHAT IS REFUSED — a relation to a soft-deletable model in an `include` or a `select`:
//
//   a list relation    without `where: { deletedAt: null, … }` on the relation itself
//                      (`sessions: true`, `sessions: { where: { status } }`, `deletedAt: { not: null }`)
//   a single relation  that no `where` above it filters: Prisma takes no `where` on a required single
//                      relation, so the nearest `where` that can name it carries `deletedAt: null`
//                      along the relation path (`where: { enrollment: { student: { deletedAt: null }
//                      } }` for `include: { enrollment: { include: { student: true } } }`), each step
//                      written directly or through `is`; that `where` is the query's own at the top
//                      and a list relation's own below it. An optional single relation (`T?`) may
//                      carry its own `where: { deletedAt: null }` instead, which Prisma accepts there
//   a count            `_count: { select: { <list relation>: true } }`, and `_count: true` on a
//                      model with a list relation to a soft-deletable model
//   an opaque shape    the query's arguments, an `include` or `select`, or a relation's entry that is
//                      not an object literal (a variable, a spread), on a model whose relations can
//                      reach a soft-deletable one at any depth: what it holds cannot be read, so it
//                      is refused rather than passed (review of B7, finding 1); on a model that
//                      reaches none (`idempotencyKey`), there is nothing to hide
//
// WHAT IS NOT REFUSED, and is review's. The query's own table (`tx.user.findMany` with no
// `deletedAt` filter): the rule is about relations, the reads of the table itself are its
// repository's to write and its tests' to prove. The fluent API (`findUnique(…).sessions()`), which
// FR-214 does not name (a follow-up). A deliberate read of the deleted rows (an audit, the deletion
// flow itself), or a shape the rule cannot read, takes a justified suppression (R-PROC-7), with its
// ticket and its reason.
const { readReaching, readRelations } = require('../prisma-schema');
const { defineRule } = require('../rule');
const { keyName, propertyName, unwrap } = require('../syntax');

const RETURNING_METHODS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'create',
  'createManyAndReturn',
  'update',
  'updateManyAndReturn',
  'upsert',
  'delete',
]);

const SELECTIONS = new Set(['include', 'select']);

/** `foo.repository.ts`, `foo.repository.js`, … */
function isRepositoryFile(filename) {
  const base = String(filename).split(/[\\/]/).pop() ?? '';
  return /\.repository\.[cm]?[jt]sx?$/.test(base);
}

/** The properties of an object literal by key, the wrappers off. */
function propertiesOf(node) {
  const object = unwrap(node);
  const out = new Map();
  if (object === null || object === undefined || object.type !== 'ObjectExpression') return out;
  for (const property of object.properties) {
    if (property.type !== 'Property') continue;
    const name = keyName(property);
    if (name !== null) out.set(name, property);
  }
  return out;
}

const isNull = (node) => {
  const inner = unwrap(node);
  return inner !== null && inner !== undefined && inner.type === 'Literal' && inner.value === null;
};

/** True when a `where` object literal holds `deletedAt: null`. */
function excludesDeleted(where) {
  const deletedAt = propertiesOf(where).get('deletedAt');
  return deletedAt !== undefined && isNull(deletedAt.value);
}

/**
 * True when a `where` object literal reaches `deletedAt: null` along `path`, one relation per step,
 * each step written directly or through `is` (`{ enrollment: { is: { student: { … } } } }`).
 */
function filteredAlong(where, path) {
  let node = where;
  for (const step of path) {
    const condition = propertiesOf(node).get(step);
    if (condition === undefined) return false;
    const is = propertiesOf(condition.value).get('is');
    node = is === undefined ? condition.value : is.value;
  }
  return excludesDeleted(node);
}

/** A boolean literal, or an object literal with no spread: the shapes the rule can read. */
function readable(node) {
  const inner = unwrap(node);
  if (inner === null || inner === undefined) return false;
  if (inner.type === 'Literal' && typeof inner.value === 'boolean') return true;
  return (
    inner.type === 'ObjectExpression' &&
    !inner.properties.some((property) => property.type === 'SpreadElement')
  );
}

/**
 * A relation by its name alone, for a delegate whose model is unknown: the relation every model
 * declaring that name agrees on, or undefined when they disagree or none declares it.
 */
function relationByName(relations, name) {
  let found;
  for (const model of relations.values()) {
    const relation = model.get(name);
    if (relation === undefined) continue;
    if (found === undefined) found = relation;
    else if (found.target !== relation.target || found.list !== relation.list) return undefined;
  }
  return found;
}

const accessorOf = (model) => model.charAt(0).toLowerCase() + model.slice(1);

module.exports = defineRule({
  constitutionId: 'R-DB-3',
  description:
    'Bans reading a relation to a soft-deletable model without excluding its deleted rows, in a *.repository.ts file',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    unfilteredList:
      '"{{relation}}" reads {{model}} rows with the soft-deleted ones — give the relation where: { deletedAt: null }, because a deleted row is excluded from every ordinary read',
    unfilteredSingle:
      '"{{relation}}" reads a {{model}} row that may be soft-deleted — filter the query\'s own rows with where: { {{relation}}: { deletedAt: null } }, through every relation above it, because a required single relation takes no where of its own',
    unfilteredCount:
      "_count: true counts the soft-deleted rows of {{model}}'s relations — count each relation with where: { deletedAt: null }",
    opaqueSelection:
      'this {{key}} is not an object literal the rule can read (a variable, a spread) — write it in place, or suppress with a ticket and the reason its relations exclude the deleted rows',
    opaqueArguments:
      "the query's arguments are not an object literal the rule can read (a variable, a spread) — write them in place, or suppress with a ticket and the reason their relations exclude the deleted rows",
  },
  create(context) {
    if (!isRepositoryFile(context.filename)) return {};
    const relations = readRelations();
    const reaching = readReaching();

    /** The relation `name` of `model`, or by name alone when the model is unknown. */
    function relationOf(model, name) {
      if (model !== undefined) return relations.get(accessorOf(model))?.get(name);
      return relationByName(relations, name);
    }

    /**
     * True when a read of `model` can reach a soft-deletable row through its relations, at any
     * depth (`readReaching`, a fixpoint over the whole schema); an unknown model is assumed to. An
     * opaque shape on a model that cannot is harmless.
     */
    function reachesSoftDeleted(model) {
      return model === undefined || reaching.has(model);
    }

    /**
     * Checks the `include` and `select` of one level of a query. `model` is the level's model, if
     * known; `filters` are the `where` objects that filter the level's rows, each with the relation
     * path from its own level down to this one (the query's `where` at the top; a list relation's
     * own `where` below it; a single relation adds itself to the path of every filter above).
     */
    function checkLevel(level, model, filters) {
      for (const [key, holder] of propertiesOf(level)) {
        if (!SELECTIONS.has(key)) continue;
        if (!readable(holder.value)) {
          if (!reachesSoftDeleted(model)) continue;
          context.report({ node: holder, messageId: 'opaqueSelection', data: { key } });
          continue;
        }
        for (const [name, entry] of propertiesOf(holder.value)) {
          if (name === '_count') {
            checkCount(entry, model);
            continue;
          }
          const relation = relationOf(model, name);
          if (relation === undefined) continue;
          if (!readable(entry.value)) {
            if (!relation.softDeletable && !reachesSoftDeleted(relation.target)) continue;
            context.report({ node: entry, messageId: 'opaqueSelection', data: { key } });
            continue;
          }
          const own = propertiesOf(entry.value).get('where')?.value;
          if (relation.list) {
            if (relation.softDeletable && !excludesDeleted(own)) {
              context.report({
                node: entry,
                messageId: 'unfilteredList',
                data: { relation: name, model: relation.target },
              });
            }
            checkLevel(entry.value, relation.target, [{ where: own, path: [] }]);
            continue;
          }
          const below = filters.map((filter) => ({
            where: filter.where,
            path: [...filter.path, name],
          }));
          // Prisma takes a where on an optional single relation (`T?`), and on no required one.
          const ownFilter =
            relation.optional && own !== undefined ? [{ where: own, path: [] }] : [];
          const filtered = [...below, ...ownFilter].some((filter) =>
            filteredAlong(filter.where, filter.path),
          );
          if (relation.softDeletable && !filtered) {
            context.report({
              node: entry,
              messageId: 'unfilteredSingle',
              data: { relation: name, model: relation.target },
            });
          }
          checkLevel(entry.value, relation.target, [...below, ...ownFilter]);
        }
      }
    }

    /** `_count: true`, or `_count: { select: { … } }`. */
    function checkCount(entry, model) {
      const value = unwrap(entry.value);
      if (
        value !== null &&
        value !== undefined &&
        value.type === 'Literal' &&
        value.value === true
      ) {
        const lists = model === undefined ? undefined : relations.get(accessorOf(model));
        const counted = [...(lists?.values() ?? [])].some((r) => r.list && r.softDeletable);
        if (counted) context.report({ node: entry, messageId: 'unfilteredCount', data: { model } });
        return;
      }
      const select = propertiesOf(entry.value).get('select');
      for (const [name, counted] of propertiesOf(select?.value)) {
        const relation = relationOf(model, name);
        if (relation === undefined || !relation.softDeletable || !relation.list) continue;
        if (!excludesDeleted(propertiesOf(counted.value).get('where')?.value)) {
          context.report({
            node: counted,
            messageId: 'unfilteredList',
            data: { relation: name, model: relation.target },
          });
        }
      }
    }

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee === null || callee === undefined || callee.type !== 'MemberExpression') return;
        if (!RETURNING_METHODS.has(propertyName(callee) ?? '')) return;
        const argument = node.arguments[0];
        if (argument === undefined) return;
        // `tx.enrollment.findMany` names its model; `delegate.findMany` does not.
        const accessor = propertyName(unwrap(callee.object));
        const model = [...relations.keys()].includes(accessor ?? '')
          ? (accessor ?? '').charAt(0).toUpperCase() + (accessor ?? '').slice(1)
          : undefined;
        // Arguments the rule cannot read may hold an include it would refuse (review of B7, 1).
        if (!readable(argument)) {
          if (!reachesSoftDeleted(model)) return;
          context.report({ node: argument, messageId: 'opaqueArguments' });
          return;
        }
        checkLevel(argument, model, [
          { where: propertiesOf(argument).get('where')?.value, path: [] },
        ]);
      },
    };
  },
});
