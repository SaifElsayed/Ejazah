// api/no-push-outside-job (R-API-15) against a table of code (T042).
//
// The fixture proves one module naming the port entry. The cases that carry the rule are the
// three places that may name it (the port's own folder, the wiring file and the delivery job),
// the spellings of an import, and the vendor SDK, which is legal in the adapter's folder alone.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const moduleFile = 'apps/api/src/modules/booking/notify-inline.ts';
const notifications = 'apps/api/src/modules/notifications/notifications.service.ts';
const job = 'apps/api/src/jobs/deliver-notification.ts';
const adapter = 'apps/api/src/platform/ports/push/expo.adapter.ts';
const wiring = 'apps/api/src/platform/ports/ports.module.ts';

typescriptRuleTester().run('api/no-push-outside-job', loadRule('no-push-outside-job.js'), {
  valid: [
    {
      name: 'the delivery job naming the port',
      code: "import { push } from '../platform/ports/push/push.port';\nexport const run = () => push;",
      filename: job,
    },
    {
      name: 'the delivery job under a longer file name, and its spec',
      code: "import type { PushPort } from '../platform/ports/push/push.port';\nexport type P = PushPort;",
      filename: 'apps/api/src/jobs/deliver-notification.job.spec.ts',
    },
    {
      name: 'a file under a folder named for the delivery job',
      code: "import { push } from '../../platform/ports/push';\nexport const run = () => push;",
      filename: 'apps/api/src/jobs/deliver-notification/handler.ts',
    },
    {
      name: 'the adapter naming its own port and its vendor SDK',
      code: "import { Expo } from 'expo-server-sdk';\nimport type { PushPort } from './push.port';\nexport const x: [typeof Expo, PushPort?] = [Expo];",
      filename: adapter,
    },
    {
      name: 'the wiring file binding the port to the selected adapter',
      code: "import { FakePushAdapter } from './push/fake.adapter';\nexport const providers = [FakePushAdapter];",
      filename: wiring,
    },
    {
      name: 'a module naming another port',
      code: "import type { StoragePort } from '../../platform/ports/storage/storage.port';\nexport type S = StoragePort;",
      filename: moduleFile,
    },
    {
      name: 'a module enqueueing through its own queue helper',
      code: "import { enqueue } from '../../platform/queue';\nexport const notify = (id: string) => enqueue('deliver-notification', { id });",
      filename: notifications,
    },
    {
      name: 'a folder that only starts like the port',
      code: "import { x } from '../../platform/ports/pushover/pushover.port';\nexport default x;",
      filename: moduleFile,
    },
    {
      name: 'a package that only starts like a vendor SDK',
      code: "import x from 'apnea';\nimport y from 'web-push-types-of-my-own';\nexport default [x, y];",
      filename: moduleFile,
    },
    {
      name: 'outside the backend the rule does not read',
      code: "import { FakePushAdapter } from '../../apps/api/src/platform/ports/push/fake.adapter';\nexport default FakePushAdapter;",
      filename: 'tests/adversarial/push-payload.spec.ts',
    },
  ],
  invalid: [
    {
      name: 'the fixture: a module naming the port entry',
      code: "import { push } from '../../platform/ports/push/push.port';\nexport const send = (id: string) => push.send(id, { kind: 'k', id });",
      filename: moduleFile,
      errors: [
        {
          messageId: 'portOutsideJob',
          data: { specifier: '../../platform/ports/push/push.port' },
        },
      ],
    },
    {
      name: 'the notifications module is not the job',
      code: "import { push } from '../../platform/ports/push';\nexport default push;",
      filename: notifications,
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'another job is not the delivery job',
      code: "import { push } from '../platform/ports/push/push.port';\nexport default push;",
      filename: 'apps/api/src/jobs/send-reminder.ts',
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'a job whose name only starts like the delivery job',
      code: "import { push } from '../platform/ports/push/push.port';\nexport default push;",
      filename: 'apps/api/src/jobs/deliver-notification-batch.ts',
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'a type-only import',
      code: "import type { PushPort } from '../../platform/ports/push/push.port';\nexport type P = PushPort;",
      filename: moduleFile,
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'the inline type import',
      code: "export type P = import('../../platform/ports/push/push.port').PushPort;",
      filename: moduleFile,
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'require, import = require, a dynamic import and a re-export',
      code: [
        "const a = require('../../platform/ports/push/push.port');",
        "import b = require('../../platform/ports/push/push.port');",
        "export const c = () => import('../../platform/ports/push/push.port');",
        "export * from '../../platform/ports/push/push.port';",
        "export { push } from '../../platform/ports/push/push.port.ts';",
        'export default [a, b];',
      ].join('\n'),
      filename: moduleFile,
      errors: 5,
    },
    {
      name: 'another port folder naming the push port',
      code: "import { push } from '../push/push.port';\nexport default push;",
      filename: 'apps/api/src/platform/ports/sms/provider.adapter.ts',
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'the main entrypoint',
      code: "import { push } from './platform/ports/push';\nexport default push;",
      filename: 'apps/api/src/main.ts',
      errors: [{ messageId: 'portOutsideJob' }],
    },
    {
      name: 'a vendor SDK in a module',
      code: "import { Expo } from 'expo-server-sdk';\nexport default Expo;",
      filename: moduleFile,
      errors: [{ messageId: 'vendorOutsideAdapter', data: { specifier: 'expo-server-sdk' } }],
    },
    {
      name: 'a vendor SDK subpath, by require',
      code: "const { getMessaging } = require('firebase-admin/messaging');\nexport default getMessaging;",
      filename: notifications,
      errors: [
        { messageId: 'vendorOutsideAdapter', data: { specifier: 'firebase-admin/messaging' } },
      ],
    },
    {
      name: 'a vendor SDK in the job, which speaks the port',
      code: "import apn from '@parse/node-apn';\nexport default apn;",
      filename: job,
      errors: [{ messageId: 'vendorOutsideAdapter' }],
    },
    {
      name: 'a vendor SDK in the wiring file',
      code: "import webpush from 'web-push';\nexport default webpush;",
      filename: wiring,
      errors: [{ messageId: 'vendorOutsideAdapter' }],
    },
  ],
});
