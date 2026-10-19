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

/** @type {ReturnType<typeof softDeletableRelations> | undefined} */
let cached;

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

module.exports = { parseSchema, readRelations, softDeletableRelations };
