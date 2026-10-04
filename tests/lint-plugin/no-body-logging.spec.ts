// sec/no-body-logging (R-SEC-2) against a table of code (T040).
//
// The fixture proves `logger.info('…', req.body)`. This table proves the body reaching the logger
// by every route a rule that compared the argument node directly would miss — optional chaining,
// a nested object, a conditional, a nullish default — and the other values R-SEC-2 lists, found by
// what their name says.
//
// Half the table is the vocabulary that must STAY loggable, because the domain collides with the
// list: a teaching session's id is not an authentication session, and the payout timestamps are
// ERD columns that say when, not which account.

import { typescriptRuleTester, loadRule } from '../support/rule-tester';

const module_ = 'apps/api/src/modules/identity/otp-request-log.ts';

typescriptRuleTester().run('sec/no-body-logging', loadRule('no-body-logging.js'), {
  valid: [
    {
      name: 'a message and plain identifiers',
      code: "logger.info('enrollment confirmed', { enrollmentId, studentId, correlationId });",
      filename: module_,
    },
    {
      name: 'a teaching session id, camelCase and snake_case',
      code: "logger.info('session evaluated', { sessionId, session_id: row.session_id, sessionCount });",
      filename: module_,
    },
    {
      name: 'the payout timestamps',
      code: "logger.info('payout verified', { payoutVerifiedAt, payout_configured_at: profile.payout_configured_at });",
      filename: module_,
    },
    {
      name: 'payout on its own',
      code: "logger.info('payout setup opened', { payout: 'opened', payoutStatus });",
      filename: module_,
    },
    {
      name: 'a key that is not a secret',
      code: "logger.info('replayed', { idempotencyKey, storage_key: file.storage_key, keyCount });",
      filename: module_,
    },
    {
      name: 'a field picked out of the body by a harmless name',
      code: "logger.info('locale changed', { locale: req.body.locale, agent: req.headers['user-agent'] });",
      filename: module_,
    },
    {
      name: 'a fact about a prohibited value',
      code: "logger.info('auth', { hasToken: !!token, tokenPresent: token !== undefined, otpSent: true });",
      filename: module_,
    },
    {
      name: 'the body used, not logged',
      code: 'const input = schema.parse(req.body);\nlogger.info("parsed", { fields: Object.keys(input).length });',
      filename: module_,
    },
    {
      name: 'the body handed to something that is not a logger',
      code: 'export const r = () => service.info(req.body);',
      filename: module_,
    },
    {
      name: 'Math.log is not a logger',
      code: 'export const l = (token: number) => Math.log(token);',
      filename: module_,
    },
    {
      name: 'a body that is not a request’s',
      code: "logger.info('message stored', { length: message.body.length, response: res.statusCode });",
      filename: module_,
    },
    {
      name: 'words compared whole',
      code: "logger.info('parsed', { tokenizer, networkId, cardinality, secretary, keynote });",
      filename: module_,
    },
    {
      name: 'an error',
      code: "logger.error('confirm-enrollment failed', error);",
      filename: module_,
    },
  ],
  invalid: [
    {
      name: 'the fixture: the raw body',
      code: "logger.info('otp requested', req.body);",
      filename: module_,
      errors: [{ messageId: 'requestBag', data: { text: 'req.body', bag: 'body' } }],
    },
    {
      name: 'optional chaining',
      code: "logger.info('otp requested', req?.body);",
      filename: module_,
      errors: [{ messageId: 'requestBag', data: { text: 'req?.body', bag: 'body' } }],
    },
    {
      name: 'an optional call on the logger',
      code: "logger?.info('otp requested', req.body);",
      filename: module_,
      errors: 1,
    },
    {
      name: 'a computed name, a non-null assertion and a cast',
      code: "logger.info('a', req['body']);\nlogger.info('b', req!.body);\nlogger.info('c', (req as Incoming).body as object);",
      filename: module_,
      errors: 3,
    },
    {
      name: 'a nested object property',
      code: "logger.info('otp requested', { ctx: { payload: req.body } });",
      filename: module_,
      errors: 1,
    },
    {
      name: 'an array element',
      code: "logger.info('otp requested', [req.body]);",
      filename: module_,
      errors: 1,
    },
    {
      name: 'a conditional',
      code: "logger.info('otp requested', debug ? req.body : null);",
      filename: module_,
      errors: 1,
    },
    {
      name: 'a nullish default and a logical or',
      code: "logger.info('a', req.body ?? {});\nlogger.info('b', req.body || undefined);",
      filename: module_,
      errors: 2,
    },
    {
      name: 'a spread',
      code: "logger.info('otp requested', { ...req.body });",
      filename: module_,
      errors: 1,
    },
    {
      name: 'a template literal and a concatenation',
      code: "logger.info(`body ${req.body}`);\nlogger.info('body ' + req.body);",
      filename: module_,
      errors: 2,
    },
    {
      name: 'JSON.stringify',
      code: "logger.info('otp requested', JSON.stringify(req.body));",
      filename: module_,
      errors: 1,
    },
    {
      name: 'the raw body, the headers and the cookies',
      code: "logger.info('a', req.rawBody);\nlogger.info('b', req.headers);\nlogger.info('c', req.cookies);",
      filename: module_,
      errors: [
        { messageId: 'requestBag', data: { text: 'req.rawBody', bag: 'rawBody' } },
        { messageId: 'requestBag', data: { text: 'req.headers', bag: 'headers' } },
        { messageId: 'requestBag', data: { text: 'req.cookies', bag: 'cookies' } },
      ],
    },
    {
      name: 'a request under its other names',
      code: "logger.info('a', request.body);\nlogger.info('b', ctx.req.body);\nlogger.info('c', this.request.body);\nlogger.info('d', incomingRequest.body);",
      filename: module_,
      errors: 4,
    },
    {
      name: 'every logger shape and level',
      code: "console.log(req.body);\nthis.logger.warn(req.body);\nctx.log.error(req.body);\nreq.log.debug(req.body);\ngetLogger().trace(req.body);\nlogger.child({ module: 'x' }).fatal(req.body);",
      filename: module_,
      errors: 6,
    },
    {
      name: 'child bindings are logged on every line',
      code: 'export const scoped = logger.child({ accessToken });',
      filename: module_,
      errors: 1,
    },
    {
      name: 'a one-time code',
      code: "logger.info('otp', otp);\nlogger.info('otp', { otpCode: code });\nlogger.info('otp', req.body.otp);",
      filename: module_,
      errors: 3,
    },
    {
      name: 'tokens',
      code: "logger.info('t', accessToken);\nlogger.info('t', user.refresh_token);\nlogger.info('t', { pushTokens });\nlogger.info('t', sessionToken);",
      filename: module_,
      errors: [
        { messageId: 'prohibitedValue', data: { name: 'accessToken', kind: 'a token' } },
        { messageId: 'prohibitedValue', data: { name: 'refresh_token', kind: 'a token' } },
        { messageId: 'prohibitedValue', data: { name: 'pushTokens', kind: 'a token' } },
        { messageId: 'prohibitedValue', data: { name: 'sessionToken', kind: 'a token' } },
      ],
    },
    {
      name: 'an authentication session',
      code: "logger.info('s', authSessionId);\nlogger.info('s', req.headers.authorization);\nlogger.info('s', req.headers['cookie']);",
      filename: module_,
      errors: [
        {
          messageId: 'prohibitedValue',
          data: { name: 'authSessionId', kind: 'a session identifier' },
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'authorization', kind: 'a session identifier' },
        },
        { messageId: 'prohibitedValue', data: { name: 'cookie', kind: 'a session identifier' } },
      ],
    },
    {
      name: 'a request body under its own name',
      code: "logger.info('b', requestBody);\nlogger.info('b', { raw_body: buffer });",
      filename: module_,
      errors: 2,
    },
    {
      name: 'a payment payload',
      code: "logger.info('p', gatewayPayload);\nlogger.info('p', event.webhook_payload);",
      filename: module_,
      errors: [
        {
          messageId: 'prohibitedValue',
          data: { name: 'gatewayPayload', kind: 'a payment payload' },
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'webhook_payload', kind: 'a payment payload' },
        },
      ],
    },
    {
      name: 'a document URL',
      code: "logger.info('d', documentUrl);\nlogger.info('d', { signed_url: link });",
      filename: module_,
      errors: 2,
    },
    {
      name: 'a payout identifier',
      code: "logger.info('p', payoutAccountRef);\nlogger.info('p', profile.payout_account_ref_encrypted);\nlogger.info('p', payoutRecipient);",
      filename: module_,
      errors: [
        {
          messageId: 'prohibitedValue',
          data: { name: 'payoutAccountRef', kind: 'a payout identifier' },
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'payout_account_ref_encrypted', kind: 'a payout identifier' },
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'payoutRecipient', kind: 'a payout identifier' },
        },
      ],
    },
    {
      name: 'a card fragment',
      code: "logger.info('c', cardLast4);\nlogger.info('c', { card_number: pan });\nlogger.info('c', cvv);",
      filename: module_,
      errors: 3,
    },
    {
      name: 'a credential',
      code: "logger.info('k', password);\nlogger.info('k', config.gatewayApiKey);\nlogger.info('k', { webhook_secret: value });\nlogger.info('k', signingKey);",
      filename: module_,
      errors: 4,
    },
    {
      name: 'a prohibited value behind a conditional and a nullish default',
      code: "logger.info('t', verbose ? accessToken : undefined);\nlogger.info('t', refreshToken ?? 'none');",
      filename: module_,
      errors: 2,
    },
    {
      name: 'the mobile application is not exempt',
      code: 'console.warn("sign-in failed", { refreshToken });',
      filename: 'apps/mobile/src/lib/client.ts',
      errors: 1,
    },
  ],
});
