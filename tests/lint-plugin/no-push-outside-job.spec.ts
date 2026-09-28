// api/no-push-outside-job (R-API-15) against a table of code (T042).
//
// The fixture proves one module reaching the push port through one `import`. This table proves
// the decision the rule header records: the whole port folder is what is confined, in every
// spelling `specifiers.js` knows including the two type-only forms, and the three places allowed
// to name it are the folder itself, the `deliver-notification` job as a file or as a folder, and
// the ports module where the adapter is bound. A vendor SDK is refused everywhere but the folder,
// the job included, because the job delivers through the port and never through the SDK. Nothing
// outside `apps/api` is read, so a port contract test under `tests/ports/` stays free to prove
// the adapter, and another port such as sms is not this rule's concern.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const booking = 'apps/api/src/modules/booking/notify-inline.ts';
const router = 'apps/api/src/surfaces/booking.router.ts';
const main = 'apps/api/src/main.ts';
const otherJob = 'apps/api/src/jobs/send-reminder.ts';
const jobFile = 'apps/api/src/jobs/deliver-notification.ts';
const jobFolder = 'apps/api/src/jobs/deliver-notification/index.ts';
const adapter = 'apps/api/src/platform/ports/push/expo.adapter.ts';
const portsModule = 'apps/api/src/platform/ports/ports.module.ts';
const contractTest = 'tests/ports/push.spec.ts';

const fromModule = '../../platform/ports/push/push.port';

typescriptRuleTester().run('api/no-push-outside-job', loadRule('no-push-outside-job.js'), {
  valid: [
    {
      name: 'the delivery job as a file',
      code: "import { push } from '../platform/ports/push/push.port';\nexport const deliver = push;",
      filename: jobFile,
    },
    {
      name: 'the delivery job as a folder',
      code: "import { push } from '../../platform/ports/push/push.port';\nexport const deliver = push;",
      filename: jobFolder,
    },
    {
      name: 'an adapter inside the port folder, wrapping the vendor SDK',
      code: "import { Expo } from 'expo-server-sdk';\nimport type { PushPort } from './push.port';\nexport const expo: PushPort = new Expo();",
      filename: adapter,
    },
    {
      name: 'the ports module binding the port to its adapter',
      code: "import { push } from './push/push.port';\nexport const ports = { push };",
      filename: portsModule,
    },
    {
      name: 'a port contract test outside apps/api',
      code: "import { push } from '../../apps/api/src/platform/ports/push/push.port';\nexport const subject = push;",
      filename: contractTest,
    },
    {
      name: 'a module reaching another port',
      code: "import { sms } from '../../platform/ports/sms/sms.port';\nexport const send = sms;",
      filename: booking,
    },
    {
      name: 'a module enqueueing the job instead of delivering',
      code: "import { enqueueDeliverNotification } from '../../jobs/deliver-notification';\nexport const notify = enqueueDeliverNotification;",
      filename: booking,
    },
    {
      name: 'a package whose name merely starts alike',
      code: "import { x } from 'web-pushover';\nexport const y = x;",
      filename: booking,
    },
  ],
  invalid: [
    {
      name: 'the canonical import from a module',
      code: `import { push } from '${fromModule}';\nexport const notify = (id: string) => push.send(id, {});`,
      filename: booking,
      errors: [{ messageId: 'inlineDelivery', data: { specifier: fromModule } }],
    },
    {
      name: 'a type-only import',
      code: `import type { PushPort } from '${fromModule}';\nexport type P = PushPort;`,
      filename: booking,
      errors: [{ messageId: 'inlineDelivery', data: { specifier: fromModule } }],
    },
    {
      name: 'a type-only import written as an import type node',
      code: `export type P = import('${fromModule}').PushPort;`,
      filename: booking,
      errors: 1,
    },
    {
      name: 'require',
      code: `const { push } = require('${fromModule}');\nexport default push;`,
      filename: booking,
      errors: 1,
    },
    {
      name: 'import = require',
      code: `import port = require('${fromModule}');\nexport default port;`,
      filename: booking,
      errors: 1,
    },
    {
      name: 'a dynamic import',
      code: `export const load = () => import('${fromModule}');`,
      filename: booking,
      errors: 1,
    },
    {
      name: 'export from',
      code: `export { push } from '${fromModule}';`,
      filename: booking,
      errors: 1,
    },
    {
      name: 'an adapter inside the folder, not only the port entry',
      code: "import { expo } from '../../platform/ports/push/expo.adapter';\nexport const send = expo;",
      filename: booking,
      errors: [{ messageId: 'inlineDelivery' }],
    },
    {
      name: 'a router',
      code: "import { push } from '../platform/ports/push/push.port';\nexport const notify = push;",
      filename: router,
      errors: [{ messageId: 'inlineDelivery' }],
    },
    {
      name: 'the process entry',
      code: "import { push } from './platform/ports/push/push.port';\nexport const notify = push;",
      filename: main,
      errors: [{ messageId: 'inlineDelivery' }],
    },
    {
      name: 'another job, which is not the delivery job',
      code: "import { push } from '../platform/ports/push/push.port';\nexport const remind = push;",
      filename: otherJob,
      errors: [{ messageId: 'inlineDelivery' }],
    },
    {
      name: 'a vendor SDK from a module',
      code: "import { Expo } from 'expo-server-sdk';\nexport const expo = new Expo();",
      filename: booking,
      errors: [{ messageId: 'vendorSdk', data: { specifier: 'expo-server-sdk' } }],
    },
    {
      name: 'a vendor SDK subpath from the delivery job itself',
      code: "import { getMessaging } from 'firebase-admin/messaging';\nexport const messaging = getMessaging();",
      filename: jobFile,
      errors: [{ messageId: 'vendorSdk', data: { specifier: 'firebase-admin/messaging' } }],
    },
    {
      name: 'a vendor SDK from the ports module',
      code: "import webPush from 'web-push';\nexport const w = webPush;",
      filename: portsModule,
      errors: [{ messageId: 'vendorSdk', data: { specifier: 'web-push' } }],
    },
  ],
});
