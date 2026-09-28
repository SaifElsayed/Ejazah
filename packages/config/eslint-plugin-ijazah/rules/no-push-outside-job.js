// api/no-push-outside-job  ->  R-API-15  (fast)
//
// R-API-15: never send a notification inline. Queued with retry, always (FR-NOTIF-4). A push sent
// from a request handler fails with the request, retries with the request or not at all, and
// blocks the response on a vendor's latency; the `deliver-notification` job under `apps/api/src/jobs/`
// is where the worker delivers it with retry (FR-057). The constitution's mechanism is "push
// adapter import banned outside the notification job"; the contract says "notification delivery
// reached outside the queued job", and the fixture reaches the port, not an adapter — so the whole
// push port folder is what is confined, not only the adapters inside it.
//
// DECISION (T042) — who may name the push port (`apps/api/src/platform/ports/push/`, any file in
// it, in every import spelling `../specifiers.js` knows, type-only forms included):
//
//   - the port folder itself: the adapters implement the port and the port's tests exercise them;
//   - the job, `apps/api/src/jobs/deliver-notification` — as a file or as a folder, so it may grow a
//     test and a payload schema beside it;
//   - the ports module, `apps/api/src/platform/ports/ports.module.ts`, which is where every port is
//     bound to its adapter for the process (R-API-4 already confines adapters to the folder; the
//     module is the composition root the worker starts from).
//
// Everything else under `apps/api` — a module service, a router, `main.ts`, another job — enqueues
// the job and never sees the port. `tests/**` outside `apps/api` is not read: a port contract test
// (`tests/ports/`) proves the adapter and is not a delivery path.
//
// The vendor SDKs a push adapter wraps — `expo-server-sdk`, `firebase-admin` (and its `messaging`
// subpath), `@onesignal/node-onesignal`, `node-apn`, `web-push`, `node-pushnotifications` — are
// refused outside the port folder too. Importing the SDK directly is delivery reached without
// even the port, which is R-API-15 and R-API-4 broken at once; the message here names this one.
//
// The file is matched by its path segments, never by a path anchored at the repository root: the
// violation fixtures mirror the real tree under `tests/violations/fixtures/` (note under T035).
const { defineRule } = require('../rule');
const { isAt, isUnder } = require('../files');
const { onEverySpecifier, resolveTarget, segmentsOf, after } = require('../specifiers');

const API_TREE = 'apps/api';
const PUSH_PORT = 'apps/api/src/platform/ports/push';
const DELIVERY_JOB = 'apps/api/src/jobs/deliver-notification';
const PORTS_MODULE = 'apps/api/src/platform/ports/ports.module';

const VENDOR_SDKS = [
  /^expo-server-sdk(\/|$)/,
  /^firebase-admin(\/|$)/,
  /^@onesignal\//,
  /^onesignal-node(\/|$)/,
  /^node-apn(\/|$)/,
  /^@parse\/node-apn(\/|$)/,
  /^web-push(\/|$)/,
  /^node-pushnotifications(\/|$)/,
];

/** True when the resolved target path passes through the push port folder. */
function namesPushPort(target) {
  return after(segmentsOf(target), segmentsOf(PUSH_PORT)) !== -1;
}

module.exports = defineRule({
  constitutionId: 'R-API-15',
  description:
    'Bans reaching the push port or a push vendor SDK from anywhere in apps/api but the deliver-notification job, the port folder and the ports module',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    inlineDelivery:
      '"{{specifier}}" reaches notification delivery from outside the queued job — enqueue the deliver-notification job and let the worker deliver with retry; only that job, the push port folder and the ports module name the port',
    vendorSdk:
      '"{{specifier}}" is a push vendor SDK reached from outside the push port — delivery goes through the port, and the port is reached only from the deliver-notification job',
  },
  create(context) {
    const filename = context.filename;
    if (!isUnder(filename, API_TREE)) return {};
    if (isUnder(filename, PUSH_PORT)) return {};
    const isJob = isAt(filename, DELIVERY_JOB);
    const isPortsModule = isAt(filename, PORTS_MODULE);

    function check(sourceNode) {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier !== 'string') return;

      if (VENDOR_SDKS.some((sdk) => sdk.test(specifier))) {
        context.report({ node: sourceNode, messageId: 'vendorSdk', data: { specifier } });
        return;
      }

      if (isJob || isPortsModule) return;
      const target = resolveTarget(filename, specifier);
      if (target === null || !namesPushPort(target)) return;
      context.report({ node: sourceNode, messageId: 'inlineDelivery', data: { specifier } });
    }

    return onEverySpecifier(check);
  },
});
