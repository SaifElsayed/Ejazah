// boundaries/no-upward-admin-import  ->  R-API-4  (upward half, fast)
//
// R-API-4 carries two prohibitions under one identifier and two rules cite it
// (contracts/lint-rules.md, "Two notes on identifier traceability"). This is the upward half:
// dependencies point inward and nothing points at `admin`. A domain module that imports the
// administrative module inverts the dependency and makes the domain unusable without it (FR-004).
// The other half, a concrete adapter named outside its port folder, is `no-adapter-import.js`, and
// each message states which half broke so a build log naming R-API-4 is never ambiguous.
//
// DECISION (T035) — a rule of the internal plugin rather than `eslint-plugin-boundaries`
// configuration, so the reported rule id is the id the contract publishes; see the header of
// `no-cross-role-import.js`.
//
// The public entry is refused along with everything below it: `../admin` is as upward as
// `../admin/admin.service`. Reaching below the entry is separately a deep import (R-API-3), which
// is why this rule looks only at which module the import lands in. Admin's own files may of course
// import admin.
//
// WHO IS CHECKED (T035, review of PR #20): every file outside the admin module, not only files
// inside `modules/`. `platform/`, a shared package or a surface reaching into `modules/admin`
// inverts the same dependency for the same reason — the kernel and the packages sit *below* the
// modules, so an import from there into the administrative module is as upward as it gets
// (R-API-4). The rule asks only whether the importer is admin's own code.
//
// THE THREE COMPOSITION FILES (T143): `apps/api/src/main.ts`, `apps/api/src/worker.ts` and
// `apps/api/src/surfaces/admin.router.ts`, listed as `adminCompositionFiles` in the wall data, sit
// above every module, so their import of admin is not upward: the two entry points bind admin's
// `AuditWriter` and `SettingsReader`, and the admin router mounts the module. They may import the
// public entry (`modules/admin` or `modules/admin/index`) and nothing below it, which stays refused
// here as well as by R-API-3. Every other file outside admin — `surfaces/app.router.ts`,
// `surfaces/procedures.ts`, a job, the kernel, another module — is refused as before.
//
// Path segments, never a root-anchored path (note under T035). A relative specifier is resolved
// against the importing file and a configured path alias is expanded first; anything else is a
// package, never a path inside another module.
const { defineRule } = require('../rule');
const {
  after,
  onEverySpecifier,
  resolveTarget,
  segmentsOf,
  settingsFor,
} = require('../specifiers');

function moduleOf(value, moduleRoot) {
  const segments = segmentsOf(value);
  const at = after(segments, segmentsOf(moduleRoot));
  return at === -1 || at >= segments.length ? null : segments[at];
}

/** Whether `filename` ends in one of `files` as a whole run of segments. */
function isCompositionFile(filename, files) {
  const segments = segmentsOf(filename);
  return files.some((file) => {
    const needle = segmentsOf(file);
    const start = segments.length - needle.length;
    return start >= 0 && needle.every((part, offset) => segments[start + offset] === part);
  });
}

/** Whether `target` is the module's public entry: the folder itself or its `index` file. */
function isPublicEntry(target, moduleRoot) {
  const segments = segmentsOf(target);
  const rest = segments.slice(after(segments, segmentsOf(moduleRoot)) + 1);
  if (rest.length === 0) return true;
  return rest.length === 1 && rest[0].replace(/\.[^.]*$/, '') === 'index';
}

module.exports = defineRule({
  constitutionId: 'R-API-4',
  description: 'Bans a domain module from importing upward into the administrative module',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011). "upward import into
    // admin" says which of the two halves this identifier carries was broken.
    upwardIntoAdmin:
      '"{{specifier}}" is an upward import into admin from {{importer}} — dependencies point inward and nothing points at the administrative module, so let admin call down instead',
  },
  create(context) {
    const { moduleRoot, adminModule, adminCompositionFiles, aliases } = settingsFor(context);
    const own = moduleOf(context.filename, moduleRoot);
    if (own === adminModule) return {};
    const composes = isCompositionFile(context.filename, adminCompositionFiles);
    const importer = own === null ? 'outside the module tree' : `the ${own} module`;

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const target = resolveTarget(context.filename, sourceNode.value, aliases);
      if (target === null) return;
      if (moduleOf(target, moduleRoot) !== adminModule) return;
      if (composes && isPublicEntry(target, moduleRoot)) return;

      context.report({
        node: sourceNode,
        messageId: 'upwardIntoAdmin',
        data: { specifier: String(sourceNode.value), importer },
      });
    });
  },
});
