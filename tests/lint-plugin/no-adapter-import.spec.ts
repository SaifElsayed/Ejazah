// boundaries/no-adapter-import (R-API-4, adapter half) against a table of code (T035).
//
// The domain depends on the port; which adapter serves it is configuration. The cases that carry
// the rule are the two exemptions: the port entry, which is the name the rest of the application
// is allowed to speak, and a file inside the port's own folder, where the vendor is at home.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const service = 'apps/api/src/modules/payments/payments.service.ts';
const portFolder = 'apps/api/src/platform/ports/payment/index.ts';

typescriptRuleTester().run('boundaries/no-adapter-import', loadRule('no-adapter-import.js'), {
  valid: [
    {
      name: 'the port itself',
      code: "import type { PaymentPort } from '../../platform/ports/payment/payment.port';",
      filename: service,
    },
    {
      name: 'the port folder',
      code: "import { PAYMENT_PORT } from '../../platform/ports/payment';",
      filename: service,
    },
    {
      name: 'the port folder wiring its own adapter',
      code: "import { FakePaymentAdapter } from './fake.adapter';",
      filename: portFolder,
    },
    { name: 'a package', code: "import { z } from 'zod';", filename: service },
  ],
  invalid: [
    {
      name: 'a concrete adapter named by a module',
      code: "import { FakePaymentAdapter } from '../../platform/ports/payment/fake.adapter';",
      filename: service,
      errors: [
        {
          messageId: 'outsidePortFolder',
          data: { specifier: '../../platform/ports/payment/fake.adapter', port: 'payment' },
        },
      ],
    },
    {
      name: 'a concrete adapter with an extension',
      code: "import { FakePaymentAdapter } from '../../platform/ports/payment/fake.adapter.ts';",
      filename: service,
      errors: 1,
    },
    {
      name: 'another port’s adapter named from inside a port folder',
      code: "import { LocalStorageAdapter } from '../storage/local.adapter';",
      filename: portFolder,
      errors: [
        {
          messageId: 'outsidePortFolder',
          data: { specifier: '../storage/local.adapter', port: 'storage' },
        },
      ],
    },
    {
      name: 'require',
      code: "const { FakePaymentAdapter } = require('../../platform/ports/payment/fake.adapter');",
      filename: service,
      errors: 1,
    },
    {
      name: 'import = require',
      code: "import adapter = require('../../platform/ports/payment/fake.adapter');\nexport default adapter;",
      filename: service,
      errors: 1,
    },
    {
      name: 'export * from',
      code: "export * from '../../platform/ports/payment/fake.adapter';",
      filename: service,
      errors: 1,
    },
  ],
});
