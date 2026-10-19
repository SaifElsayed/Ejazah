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
//   a single relation  whose query does not filter its own rows by it: Prisma takes no `where` on
//                      a single relation, so the object holding the `include` or `select` carries
//                      `where: { <relation>: { deletedAt: null } }` or `{ <relation>: { is: {
//                      deletedAt: null } } }`; at the top that is the query's own `where`, nested it
//                      is the `where` of the list relation the single one sits in
//   a count            `_count: { select: { <list relation>: true } }`, and `_count: true` on a
//                      model with a list relation to a soft-deletable model
//
// WHAT IS NOT REFUSED, and is review's. The query's own table (`tx.user.findMany` with no
// `deletedAt` filter): the rule is about relations, the reads of the table itself are its
// repository's to write and its tests' to prove. A filter assembled from a variable (`where:
// filter`): the rule reads object literals only, so such a relation is refused and the escape is a
// justified suppression (R-PROC-7). A deliberate read of the deleted rows (an audit, the deletion
// flow itself) takes that same suppression, with its ticket and its reason.
const { readRelations } = require('../prisma-schema');
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

/** True when a `where` object literal filters its rows by a single relation's `deletedAt: null`. */
function filtersBy(where, relation) {
  const condition = propertiesOf(where).get(relation);
  if (condition === undefined) return false;
  if (excludesDeleted(condition.value)) return true;
  const is = propertiesOf(condition.value).get('is');
  return is !== undefined && excludesDeleted(is.value);
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
      '"{{relation}}" reads a {{model}} row that may be soft-deleted — filter the query\'s own rows with where: { {{relation}}: { deletedAt: null } }, because a single relation takes no where of its own',
    unfilteredCount:
      "_count: true counts the soft-deleted rows of {{model}}'s relations — count each relation with where: { deletedAt: null }",
  },
  create(context) {
    if (!isRepositoryFile(context.filename)) return {};
    const relations = readRelations();

    /** The relation `name` of `model`, or by name alone when the model is unknown. */
    function relationOf(model, name) {
      if (model !== undefined) return relations.get(accessorOf(model))?.get(name);
      return relationByName(relations, name);
    }

    /**
     * Checks the `include` and `select` of one level of a query: `level` is the object that holds
     * them and the `where` its single relations are filtered by; `model` is its model, if known.
     */
    function checkLevel(level, model) {
      const properties = propertiesOf(level);
      const where = properties.get('where')?.value;
      for (const [key, holder] of properties) {
        if (!SELECTIONS.has(key)) continue;
        for (const [name, entry] of propertiesOf(holder.value)) {
          if (name === '_count') {
            checkCount(entry, model);
            continue;
          }
          const relation = relationOf(model, name);
          if (relation === undefined) continue;
          if (relation.softDeletable) {
            if (relation.list) {
              if (!excludesDeleted(propertiesOf(entry.value).get('where')?.value)) {
                context.report({
                  node: entry,
                  messageId: 'unfilteredList',
                  data: { relation: name, model: relation.target },
                });
              }
            } else if (!filtersBy(where, name)) {
              context.report({
                node: entry,
                messageId: 'unfilteredSingle',
                data: { relation: name, model: relation.target },
              });
            }
          }
          checkLevel(entry.value, relation.target);
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
        checkLevel(argument, model);
      },
    };
  },
});
