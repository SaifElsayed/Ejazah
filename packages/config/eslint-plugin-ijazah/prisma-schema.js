// T026 (research R-116): the Prisma schema as `db/no-unfiltered-relation-read` reads it. The rule
// runs without types (fast set), so the multi-file schema under `prisma/schema/` is parsed here,
// at lint time, for the one thing the rule needs: each model's relation fields, whether each is a
// list, and which models carry `deletedAt` (the soft-deletable ones, ERD §0: users, sessions,
// enrollments, ijazahs). A model added with `deletedAt` is covered without an edit here.
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const SCHEMA_DIRECTORY = path.join(__dirname, '..', '..', '..', 'prisma', 'schema');
const MODEL = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
const FIELD = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?(?:\s|$)/;
const LINE_COMMENT = /\/\/.*$/gm;

/**
 * The models of a schema text: name → { fields: name → { type, list }, softDeletable }. A field is
 * a relation when its type names a model of the same schema (`relationsOf`).
 *
 * @param {string} text
 */
function parseSchema(text) {
  /** @type {Map<string, { fields: Map<string, { type: string, list: boolean }>, softDeletable: boolean }>} */
  const models = new Map();
  for (const [, name, body] of text.replace(LINE_COMMENT, '').matchAll(MODEL)) {
    const fields = new Map();
    for (const line of body.split('\n')) {
      const match = FIELD.exec(line);
      if (match === null || line.trim().startsWith('@@')) continue;
      const [, field, type, list, optional] = match;
      fields.set(field, { type, list: list === '[]', optional: optional === '?' });
    }
    models.set(name, { fields, softDeletable: fields.has('deletedAt') });
  }
  return models;
}

/**
 * Each model's relation fields, keyed by the client accessor (`user` for `User`): accessor →
 * relation → { target, list, optional, softDeletable }: `optional` for a single relation written
 * `T?`, which Prisma lets filter on itself; `softDeletable` when the target carries `deletedAt`.
 *
 * @param {ReturnType<typeof parseSchema>} models
 */
function softDeletableRelations(models) {
  /** @type {Map<string, Map<string, { target: string, list: boolean, optional: boolean, softDeletable: boolean }>>} */
  const byAccessor = new Map();
  for (const [name, model] of models) {
    const relations = new Map();
    for (const [field, { type, list, optional }] of model.fields) {
      const target = models.get(type);
      if (target !== undefined) {
        relations.set(field, {
          target: type,
          list,
          optional,
          softDeletable: target.softDeletable,
        });
      }
    }
    byAccessor.set(name.charAt(0).toLowerCase() + name.slice(1), relations);
  }
  return byAccessor;
}

/**
 * The models whose rows can reach a soft-deletable row through their relations, at any depth,
 * computed to a fixpoint over the whole schema (relations form cycles, so a memo filled while a
 * walk is in progress would keep a wrong answer; review of B7, round 2, finding 1).
 *
 * @param {ReturnType<typeof softDeletableRelations>} relations
 * @returns {Set<string>} model names, `User` and not `user`
 */
function modelsReachingSoftDeleted(relations) {
  const reaching = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [accessor, fields] of relations) {
      const model = accessor.charAt(0).toUpperCase() + accessor.slice(1);
      if (reaching.has(model)) continue;
      for (const relation of fields.values()) {
        if (relation.softDeletable || reaching.has(relation.target)) {
          reaching.add(model);
          grew = true;
          break;
        }
      }
    }
  }
  return reaching;
}

/** @type {ReturnType<typeof softDeletableRelations> | undefined} */
let cached;
/** @type {Set<string> | undefined} */
let cachedReaching;

/** The repository's schema, read once per process. */
function readRelations() {
  if (cached === undefined) {
    const text = readdirSync(SCHEMA_DIRECTORY)
      .filter((file) => file.endsWith('.prisma'))
      .sort()
      .map((file) => readFileSync(path.join(SCHEMA_DIRECTORY, file), 'utf8'))
      .join('\n');
    cached = softDeletableRelations(parseSchema(text));
  }
  return cached;
}

/** The models of the repository's schema that can reach a soft-deletable row, read once. */
function readReaching() {
  cachedReaching ??= modelsReachingSoftDeleted(readRelations());
  return cachedReaching;
}

module.exports = {
  modelsReachingSoftDeleted,
  parseSchema,
  readReaching,
  readRelations,
  softDeletableRelations,
};
