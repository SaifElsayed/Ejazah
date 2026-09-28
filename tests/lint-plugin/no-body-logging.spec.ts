// sec/no-body-logging (R-SEC-2) against a table of code (T040).
//
// The fixture proves `logger.info('otp requested', req.body)`. This table proves the two halves
// the header decides. The body half: `req`, `request` and a `req` at the end of a chain (`ctx.req`)
// are all the request, and the body is refused directly or through each wrapper it hides in — an
// object literal, a spread, an array, a template literal, `JSON.stringify` — while a field picked
// out of it (`req.body.enrollmentId`) is a value the handler has already decided is loggable and
// is review's to check. The name half: an argument whose words include one of the constitution's
// values (`otp`, `token`, `password`, `card`, `payout`) or one of the two-word pairs
// (`sessionId`, `documentUrl`) is refused by its name, in camel or snake case, while `session`
// alone is a teaching session and `enrollmentId` is an identifier the log may carry.
//
// What counts as a logger is the method name on any receiver, so `console.error` and
// `this.logger.debug` are loggers and `save(req.body)` is not. No folder is exempt.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const otpService = 'apps/api/src/modules/identity/otp.service.ts';
const fixture = 'apps/api/src/modules/identity/otp-request-log.ts';
const middleware = 'apps/api/src/platform/http/request-log.middleware.ts';
const mobile = 'apps/mobile/src/features/student/checkout.ts';

const declareLogger =
  'declare const logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void; debug(...args: unknown[]): void };\n';
const declareRequest = 'declare const req: { body: { enrollmentId: string } };\n';

typescriptRuleTester().run('sec/no-body-logging', loadRule('no-body-logging.js'), {
  valid: [
    {
      name: 'a field picked out of the body, which the handler has decided is loggable',
      code: `${declareLogger}${declareRequest}logger.info('otp requested', { enrollmentId: req.body.enrollmentId });`,
      filename: otpService,
    },
    {
      name: 'the body reduced to loggable fields and held in a local',
      code: `${declareLogger}${declareRequest}declare function pick(value: unknown): unknown;\nconst body = pick(req.body);\nlogger.info('otp requested', body);`,
      filename: otpService,
    },
    {
      name: 'session alone, which is a teaching session',
      code: `${declareLogger}declare const session: { id: string };\nlogger.info('session booked', { session });`,
      filename: 'apps/api/src/modules/booking/booking.service.ts',
    },
    {
      name: 'an enrollment identifier, which the log may carry',
      code: `${declareLogger}declare const enrollmentId: string;\nlogger.info('enrolled', enrollmentId);`,
      filename: otpService,
    },
    {
      name: 'a call that is not a logger receiving the body',
      code: `${declareRequest}declare function save(value: unknown): void;\nsave(req.body);`,
      filename: otpService,
    },
    {
      name: 'the body read by something other than a logger method on the logger',
      code: `${declareRequest}declare const logger: { child(bindings: unknown): unknown };\nexport const scoped = logger.child({ body: req.body });`,
      filename: otpService,
    },
    {
      name: 'a body that belongs to a response, not a request',
      code: `${declareLogger}declare const res: { body: unknown };\nlogger.debug('replied', res.body);`,
      filename: middleware,
    },
    {
      name: 'a body-shaped name without a request behind it',
      code: `${declareLogger}declare const payload: { body: string };\nlogger.debug('queued', payload.body);`,
      filename: otpService,
    },
  ],
  invalid: [
    {
      name: 'the raw request body handed to a logger, the fixture’s spelling',
      code: "import { logger } from '../../platform/logging/logger';\n\nexport interface IncomingRequest {\n  readonly body: unknown;\n}\n\nexport function recordOtpRequest(req: IncomingRequest): void {\n  logger.info('otp requested', req.body);\n}",
      filename: fixture,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the request spelled out in full',
      code: `${declareLogger}declare const request: { body: unknown };\nlogger.warn('rejected', request.body);`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the request at the end of a chain',
      code: `${declareLogger}declare const ctx: { req: { body: unknown } };\nlogger.info('handled', ctx.req.body);`,
      filename: middleware,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the body inside an object literal',
      code: `${declareLogger}${declareRequest}logger.info('otp requested', { body: req.body });`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the body spread into an object literal',
      code: `${declareLogger}${declareRequest}logger.info({ ...req.body, at: 'otp' });`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the body inside an array',
      code: `${declareLogger}${declareRequest}logger.debug([req.body]);`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the body inside a template literal',
      code: `${declareLogger}${declareRequest}logger.info(\`otp requested \${req.body}\`);`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the body serialised first, which changes nothing about what the line carries',
      code: `${declareLogger}${declareRequest}logger.info('otp requested', JSON.stringify(req.body));`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'the body wrapped twice, serialised inside an object',
      code: `${declareLogger}${declareRequest}logger.info({ payload: JSON.stringify(req.body) });`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'console.error, which is a logger too',
      code: `${declareRequest}declare const error: Error;\nconsole.error(error, req.body);`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'a bare log call',
      code: `${declareRequest}declare function log(...args: unknown[]): void;\nlog(req.body);`,
      filename: otpService,
      errors: [{ messageId: 'requestBody' }],
    },
    {
      name: 'an OTP by name',
      code: `${declareLogger}declare const otp: string;\nlogger.debug('sending', otp);`,
      filename: otpService,
      errors: [{ messageId: 'sensitiveValue', data: { name: 'otp', word: 'otp' } }],
    },
    {
      name: 'a session token through this.logger, in camel case',
      code: "export class SessionService {\n  private readonly logger!: { debug(...args: unknown[]): void };\n  issue(sessionToken: string): void {\n    this.logger.debug('issued', sessionToken);\n  }\n}",
      filename: 'apps/api/src/modules/identity/session.service.ts',
      errors: [{ messageId: 'sensitiveValue', data: { name: 'sessionToken', word: 'token' } }],
    },
    {
      name: 'a refresh token in snake case',
      code: `${declareLogger}declare const refresh_token: string;\nlogger.info({ refresh_token });`,
      filename: otpService,
      errors: [{ messageId: 'sensitiveValue', data: { name: 'refresh_token', word: 'token' } }],
    },
    {
      name: 'a session id, the two-word pair, in snake case',
      code: `${declareLogger}declare const session_id: string;\nlogger.info('resumed', session_id);`,
      filename: otpService,
      errors: [{ messageId: 'sensitiveValue', data: { name: 'session_id', word: 'session_id' } }],
    },
    {
      name: 'a document URL as a member of a record',
      code: `${declareLogger}declare const doc: { documentUrl: string };\nlogger.info('uploaded', doc.documentUrl);`,
      filename: 'apps/api/src/modules/verification/documents.service.ts',
      errors: [
        { messageId: 'sensitiveValue', data: { name: 'documentUrl', word: 'document_url' } },
      ],
    },
    {
      name: 'a payout account identifier',
      code: `${declareLogger}declare const payoutAccountId: string;\nlogger.info('paid', payoutAccountId);`,
      filename: 'apps/api/src/modules/payments/payments.service.ts',
      errors: [{ messageId: 'sensitiveValue', data: { name: 'payoutAccountId', word: 'payout' } }],
    },
    {
      name: 'a card fragment',
      code: `${declareLogger}declare const cardLast4: string;\nlogger.info('charged', cardLast4);`,
      filename: mobile,
      errors: [{ messageId: 'sensitiveValue', data: { name: 'cardLast4', word: 'card' } }],
    },
    {
      name: 'a password',
      code: `${declareLogger}declare const user: { password: string };\nlogger.warn('login failed', user.password);`,
      filename: otpService,
      errors: [{ messageId: 'sensitiveValue', data: { name: 'password', word: 'password' } }],
    },
    {
      name: 'the body and a code in one call, reported once each',
      code: `${declareLogger}${declareRequest}declare const otp: string;\nlogger.info(req.body, otp);`,
      filename: otpService,
      errors: 2,
    },
  ],
});
