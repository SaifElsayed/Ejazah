// api/no-push-outside-job  ->  R-API-15  (fast)
//
// R-API-15: never send a notification inline. Queued with retry, always (FR-NOTIF-4, FR-057). A
// push provider that is slow or down must never fail a booking, and a delivery that is not a job
// has no retry. The constitution's mechanism is "push adapter import banned outside the
// notification job"; contracts/ports.md says the same of the port: "reachable only from the
// queued notification job".
//
// DECISION (T042) — who may name the push port. A file cannot send through something it cannot
// name, so the rule is about naming, in every import syntax. Inside `apps/api/src`, the folder
// `platform/ports/push` — the port entry, an adapter, the folder itself — may be named by:
//
//   - a file inside that folder: the port, its adapters and their specs are at home there;
//   - `platform/ports/ports.module`, the one file that binds each port to the adapter the
//     configuration selects (ARCHITECTURE §3, FR-056);
//   - the delivery job: `jobs/deliver-notification` as a file of any extension
//     (`deliver-notification.ts`, `.job.ts`, `.spec.ts`) or anything under a folder of that name
//     (the job list in ARCHITECTURE's repository tree and in `apps/api/src/jobs/README.md`).
//
// Everything else is refused, the `notifications` module included: it templates and records a
// notification and enqueues the job; the job is what reaches the port. The T027 fixture is a
// `booking` file importing `platform/ports/push/push.port` — the port's public entry, legal under
// R-API-4, and refused here.
//
// DECISION (T042) — a type-only import is refused too (`import type { PushPort }`,
// `type P = import('…').PushPort`). A module that can type a parameter as the port can be handed
// the port and call it; `api/no-orm-outside-repository` decided the same for the database client.
//
// DECISION (T042) — vendor SDKs. A push vendor's server SDK is legal only inside
// `platform/ports/push/`, where the adapter lives; not in the job, which speaks the port
// (R-API-5), and not in the wiring file. The list is the vendors ARCHITECTURE §3.2 names ("Expo
// Notifications now, direct FCM/APNs later") and the common server SDKs for them:
// `expo-server-sdk`, `firebase-admin`, `@parse/node-apn`, `apn`, `node-apn`, `fcm-node`,
// `node-pushnotifications`, `web-push`. A package is matched by its name or a subpath of it
// (`firebase-admin/messaging`), never by a prefix of the name.
//
// The rule reads `apps/api/src` only. The mobile application receives a notification and cannot
// resolve the server's port; a spec outside the application tree may hold the stand-in.
//
// Path segments, never a root-anchored path (note under T035). A relative specifier is resolved
// against the importing file and a configured alias is expanded first, as the wall rules do; the
// port root is the wall's own `portRoot` (`packages/config/eslint.boundaries.js`).
//
// WHAT IS NOT SEEN, and is review's. The port reached without naming its folder: re-exported
// through a module of one's own, handed over as an argument, or injected by a string token
// (`@Inject('PUSH_PORT')`). A provider's HTTP endpoint called directly. A vendor SDK that is not
// on the list. Whether the job is really queued with retry is the job's own test (R-API-14).
// This rule runs without types (research R-10).
const path = require('node:path');

const { defineRule } = require('../rule');
const {
  after,
  onEverySpecifier,
  resolveTarget,
  segmentsOf,
  settingsFor,
} = require('../specifiers');

const API_SOURCE = ['apps', 'api', 'src'];
const JOBS_ROOT = [...API_SOURCE, 'jobs'];
const PUSH_PORT = 'push';
const DELIVERY_JOB = 'deliver-notification';
const WIRING_FILE = 'ports.module';

const VENDOR_SDKS = [
  'expo-server-sdk',
  'firebase-admin',
  '@parse/node-apn',
  'apn',
  'node-apn',
  'fcm-node',
  'node-pushnotifications',
  'web-push',
];

/** The segments below `root` when the path runs through it, else null. */
function below(value, root) {
  const segments = segmentsOf(value);
  const at = after(segments, root);
  return at === -1 ? null : segments.slice(at);
}

/** True when a file segment is `name` with any extensions: `name`, `name.ts`, `name.job.spec.ts`. */
function isNamed(segment, name) {
  const base = path.basename(String(segment));
  return base === name || base.startsWith(`${name}.`);
}

function vendorOf(specifier) {
  return VENDOR_SDKS.find((name) => specifier === name || specifier.startsWith(`${name}/`)) ?? null;
}

module.exports = defineRule({
  constitutionId: 'R-API-15',
  description: 'Bans naming the push port or a push vendor SDK outside the queued delivery job',
  messages: {
    // Written without the identifier; `defineRule` appends it (FR-011).
    portOutsideJob:
      '"{{specifier}}" names the push port outside the delivery job — enqueue deliver-notification instead, because a notification sent inline has no retry and a provider outage fails the request that sent it',
    vendorOutsideAdapter:
      '"{{specifier}}" is a push vendor SDK — it belongs in an adapter under platform/ports/push, and delivery is reached only through the port, from the queued deliver-notification job',
  },
  create(context) {
    if (below(context.filename, API_SOURCE) === null) return {};

    const { portRoot, aliases } = settingsFor(context);
    const portSegments = segmentsOf(portRoot);

    const inPorts = below(context.filename, portSegments);
    const insidePushFolder = inPorts !== null && inPorts.length > 1 && inPorts[0] === PUSH_PORT;
    const isWiring = inPorts !== null && inPorts.length === 1 && isNamed(inPorts[0], WIRING_FILE);

    const inJobs = below(context.filename, JOBS_ROOT);
    const isDeliveryJob =
      inJobs !== null &&
      inJobs.length > 0 &&
      (inJobs.length === 1 ? isNamed(inJobs[0], DELIVERY_JOB) : inJobs[0] === DELIVERY_JOB);

    const mayNamePort = insidePushFolder || isWiring || isDeliveryJob;

    return onEverySpecifier((sourceNode) => {
      if (sourceNode === null || sourceNode === undefined) return;
      const specifier = sourceNode.value;
      if (typeof specifier !== 'string') return;

      const target = resolveTarget(context.filename, specifier, aliases);
      if (target === null) {
        if (!insidePushFolder && vendorOf(specifier) !== null) {
          context.report({
            node: sourceNode,
            messageId: 'vendorOutsideAdapter',
            data: { specifier },
          });
        }
        return;
      }
      if (mayNamePort) return;

      const named = below(target, portSegments);
      if (named === null || named.length === 0) return;
      // `platform/ports/push`, `platform/ports/push/push.port`, `platform/ports/push/index.ts`.
      if (named[0] !== PUSH_PORT) return;

      context.report({ node: sourceNode, messageId: 'portOutsideJob', data: { specifier } });
    });
  },
});
