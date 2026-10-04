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
      name: 'a name that says when, how many or whether',
      code: "logger.info('auth', { tokenExpiresAt, passwordChangedAt, otpAttempts, otp_expires_at: row.otp_expires_at, tokenCount, hasToken, isTokenValid });\nlogger.info('otp', row.otp_expires_at, user.passwordChangedAt);",
      filename: module_,
    },
    {
      name: 'a key whose value is a string written in the source',
      code: "logger.info('auth', { token: 'present', password: '[redacted]', otp: `sent` });",
      filename: module_,
    },
    {
      name: 'a key whose value is Boolean(x)',
      code: "logger.info('auth', { token: Boolean(token), refreshToken: Boolean(session.refreshToken) });",
      filename: module_,
    },
    {
      name: 'a key whose value is what a redaction helper returns',
      code: "logger.info('auth', { token: redact(token), cardNumber: maskCard(pan), password: pii.mask(password), accessToken: hashToken(accessToken), otp: fingerprint(otp), apiKey: obfuscateKey(apiKey) });",
      filename: module_,
    },
    {
      name: 'a field picked out of the request input',
      code: "logger.info('locale changed', { locale: input.locale, page: opts.input.page, inputCount, hasInput: input !== undefined });",
      filename: module_,
    },
    {
      name: 'a bare payload is a job’s data or a deep link, not a payment payload',
      code: "logger.info('notification queued', { payload, type: job.payload.type });",
      filename: module_,
    },
    {
      name: 'a bare code is an error code, a country code or a status code',
      code: "logger.warn('gateway refused', { code, errorCode, countryCode, statusCode: res.statusCode });\nlogger.warn('gateway refused', error.code);",
      filename: module_,
    },
    {
      name: 'a code name that says when, how many or whether',
      code: "logger.info('auth', { resetCodeAttempts, hasTotp, verificationCodeExpiresAt, isMfaCodeValid, loginCodeCount, totp_verified_at: row.totp_verified_at });",
      filename: module_,
    },
    {
      name: 'half of a pair is not the pair',
      code: "logger.info('payout', { recipient, recipientStatus, reference, bookingRef, mfa, mfaEnabled, timeCode, oneCode, verification, login, reset });",
      filename: module_,
    },
    {
      name: 'ambiguous names are left to the redaction list of the logger',
      code: "logger.info('webhook', { event, gatewayEvent, storageKey, storage_key: file.storage_key });",
      filename: module_,
    },
    {
      name: 'a URL that is not a stored file’s',
      code: "logger.info('request', { url: req.url, callbackUrl, profileLink, uploadCount, downloadSpeed, certificateNumber, attachmentMime });",
      filename: module_,
    },
    {
      name: 'an avatar URL is not judged: no project document names such a file',
      code: "logger.info('profile', { avatarUrl, avatar_url: user.avatar_url, photoKey, photoCount, imageCount });",
      filename: module_,
    },
    {
      name: 'a fact about a photo URL, and a redacted one',
      code: "logger.info('profile', { hasPhotoUrl, isImageUrlSet, photoUrl: redact(photoUrl), image_url: maskUrl(row.image_url), photo_url: 'present' });",
      filename: module_,
    },
    {
      name: 'a classification code beside a one-time-code word is not the code',
      code: "logger.warn('sign-in refused', { loginErrorCode, resetStatusCode, verificationResultCode, login_error_code: row.login_error_code, mfaReasonCode, loginHttpCode, loginErrorCodes });\nlogger.warn('sign-in refused', result.loginErrorCode);",
      filename: module_,
    },
    {
      name: 'the answer of any other call is not read',
      code: "logger.info('in', getInput(), opts.getRawInputSize(), parse(await opts.getRawInput()));",
      filename: module_,
    },
    {
      name: 'a console method on something that is not the console',
      code: 'export const show = (panel: Panel, token: string) => { panel.dir(token); table.table(token); };',
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
      name: 'every method of the console prints its arguments',
      code: 'console.dir(req.body);\nconsole.table(req.body);\nconsole.assert(ok, req.body);\nconsole.group(accessToken);\nconsole[level](req.body);\nglobalThis.console.dir(req.body);',
      filename: module_,
      errors: [
        { messageId: 'requestBag', line: 1 },
        { messageId: 'requestBag', line: 2 },
        { messageId: 'requestBag', line: 3 },
        { messageId: 'prohibitedValue', line: 4 },
        { messageId: 'requestBag', line: 5 },
        { messageId: 'requestBag', line: 6 },
      ],
    },
    {
      name: 'the level names of winston and syslog',
      code: 'logger.notice(req.body);\nlogger.http(req.body);\nlogger.silly(token);\nlogger.alert(token);\nlogger.crit(req.body);\nlogger.emerg(token);',
      filename: module_,
      errors: [
        { messageId: 'requestBag', line: 1 },
        { messageId: 'requestBag', line: 2 },
        { messageId: 'prohibitedValue', line: 3 },
        { messageId: 'prohibitedValue', line: 4 },
        { messageId: 'requestBag', line: 5 },
        { messageId: 'prohibitedValue', line: 6 },
      ],
    },
    {
      name: 'a private logger and a private value',
      code: 'export class Service {\n  #logger = getLogger();\n  #refreshToken = "";\n  logger = getLogger();\n  run(req: Incoming) {\n    this.#logger.info(req.body);\n    this.logger.info(this.#refreshToken);\n  }\n}',
      filename: module_,
      errors: [
        { messageId: 'requestBag', data: { text: 'req.body', bag: 'body' }, line: 6 },
        {
          messageId: 'prohibitedValue',
          data: { name: 'refreshToken', kind: 'a token' },
          line: 7,
        },
      ],
    },
    {
      name: 'the request input handed over whole',
      code: "logger.info(input);\nlogger.info({ input });\nthis.logger.log(input);\nlogger.info(ctx.rawInput);\nlogger.info(opts.input);\nlogger.info('in', rawInput ?? null, JSON.stringify(input));",
      filename: module_,
      errors: [
        { messageId: 'requestInput', data: { text: 'input' }, line: 1 },
        { messageId: 'requestInput', data: { text: 'input' }, line: 2 },
        { messageId: 'requestInput', data: { text: 'input' }, line: 3 },
        { messageId: 'requestInput', data: { text: 'ctx.rawInput' }, line: 4 },
        { messageId: 'requestInput', data: { text: 'opts.input' }, line: 5 },
        { messageId: 'requestInput', data: { text: 'rawInput' }, line: 6 },
        { messageId: 'requestInput', data: { text: 'input' }, line: 6 },
      ],
    },
    {
      name: 'a key whose value is any other call is still judged by its name',
      code: "logger.info('a', { token: String(token) });\nlogger.info('b', { token: getToken() });\nlogger.info('c', { password: decrypt(stored) });\nlogger.info('d', { token: token.toString(), secret: util.inspect(secret) });",
      filename: module_,
      errors: [
        { messageId: 'prohibitedValue', data: { name: 'token', kind: 'a token' }, line: 1 },
        { messageId: 'prohibitedValue', data: { name: 'token', kind: 'a token' }, line: 2 },
        { messageId: 'prohibitedValue', data: { name: 'password', kind: 'a credential' }, line: 3 },
        { messageId: 'prohibitedValue', data: { name: 'token', kind: 'a token' }, line: 4 },
        { messageId: 'prohibitedValue', data: { name: 'secret', kind: 'a credential' }, line: 4 },
      ],
    },
    {
      name: 'a name ending in id is not a fact: an authentication session id stays refused',
      code: "logger.info('s', authSessionId);\nlogger.info('s', { authSessionId, auth_session_id: row.auth_session_id });",
      filename: module_,
      errors: [
        { messageId: 'prohibitedValue', line: 1 },
        { messageId: 'prohibitedValue', line: 2 },
        { messageId: 'prohibitedValue', line: 2 },
        { messageId: 'prohibitedValue', line: 2 },
      ],
    },
    {
      name: 'a fact-shaped word in the middle of a name exempts nothing',
      code: "logger.info('t', { tokenAtRest, countToken, attemptsSecret, hashedPassword: stored });",
      filename: module_,
      errors: 4,
    },
    {
      name: 'a string beside a value is still the value',
      code: "logger.info('t', { token: 'Bearer ' + token, note: `otp ${otp}` });",
      filename: module_,
      errors: 3,
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
      name: 'a payout recipient reference',
      code: "logger.info('p', recipientRef);\nlogger.info('p', profile.recipient_reference);\nlogger.info('p', { gatewayRecipientRef: ref });",
      filename: module_,
      errors: [
        {
          messageId: 'prohibitedValue',
          data: { name: 'recipientRef', kind: 'a payout identifier' },
          line: 1,
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'recipient_reference', kind: 'a payout identifier' },
          line: 2,
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'gatewayRecipientRef', kind: 'a payout identifier' },
          line: 3,
        },
      ],
    },
    {
      name: 'a one-time code under its other names',
      code: "logger.info('c', totp);\nlogger.info('c', user.totpCode);\nlogger.info('c', mfaCode);\nlogger.info('c', verificationCode);\nlogger.info('c', row.reset_code);\nlogger.info('c', loginCode);\nlogger.info('c', oneTimeCode);\nlogger.info('c', { one_time_code: value });",
      filename: module_,
      errors: [
        'totp',
        'totpCode',
        'mfaCode',
        'verificationCode',
        'reset_code',
        'loginCode',
        'oneTimeCode',
        'one_time_code',
      ].map((name, index) => ({
        messageId: 'prohibitedValue',
        data: { name, kind: 'a one-time code' },
        line: index + 1,
      })),
    },
    {
      name: 'an MFA secret is a credential',
      code: "logger.info('c', admin.mfaSecret);\nlogger.info('c', { mfa_secret_encrypted: row.mfa_secret_encrypted });",
      filename: module_,
      errors: [
        { messageId: 'prohibitedValue', data: { name: 'mfaSecret', kind: 'a credential' } },
        {
          messageId: 'prohibitedValue',
          data: { name: 'mfa_secret_encrypted', kind: 'a credential' },
        },
        {
          messageId: 'prohibitedValue',
          data: { name: 'mfa_secret_encrypted', kind: 'a credential' },
        },
      ],
    },
    {
      name: 'a signed URL to a stored file',
      code: "logger.info('u', certificateUrl);\nlogger.info('u', message.attachment_url);\nlogger.info('u', downloadLink);\nlogger.info('u', { uploadUri: target });\nlogger.info('u', presignedUrl);",
      filename: module_,
      errors: ['certificateUrl', 'attachment_url', 'downloadLink', 'uploadUri', 'presignedUrl'].map(
        (name, index) => ({
          messageId: 'prohibitedValue',
          data: { name, kind: 'a document URL' },
          line: index + 1,
        }),
      ),
    },
    {
      name: 'a signed URL to a photo or an image',
      code: "logger.info('u', photoUrl);\nlogger.info('u', profile.photo_url);\nlogger.info('u', { profilePhotoUrl: url });\nlogger.info('u', imageUrl);\nlogger.info('u', signatureImageUrl);\nlogger.info('u', { image_uri: target });\nlogger.info('u', photoLinks);",
      filename: module_,
      errors: [
        'photoUrl',
        'photo_url',
        'profilePhotoUrl',
        'imageUrl',
        'signatureImageUrl',
        'image_uri',
        'photoLinks',
      ].map((name, index) => ({
        messageId: 'prohibitedValue',
        data: { name, kind: 'a document URL' },
        line: index + 1,
      })),
    },
    {
      name: 'the classification qualifier excuses nothing another rule refuses',
      code: "logger.info('c', otpErrorCode);\nlogger.info('c', totpStatusCode);\nlogger.info('c', oneTimeErrorCode);\nlogger.info('c', tokenErrorCode);\nlogger.info('c', passwordResetStatusCode);\nlogger.info('c', { otp_error_code: value });",
      filename: module_,
      errors: [
        ['otpErrorCode', 'a one-time code'],
        ['totpStatusCode', 'a one-time code'],
        ['oneTimeErrorCode', 'a one-time code'],
        ['tokenErrorCode', 'a token'],
        ['passwordResetStatusCode', 'a credential'],
        ['otp_error_code', 'a one-time code'],
      ].map(([name, kind], index) => ({
        messageId: 'prohibitedValue',
        data: { name, kind },
        line: index + 1,
      })),
    },
    {
      name: 'a one-time code stays one unless the qualifier sits directly before every code',
      code: "logger.info('c', passwordResetCode);\nlogger.info('c', resetCode);\nlogger.info('c', loginCodeResult);\nlogger.info('c', resetCodeStatus);\nlogger.info('c', errorLoginCode);\nlogger.info('c', loginCodeErrorCode);\nlogger.info('c', { verification_code_result: issued });\nlogger.info('c', statusMfaCodes);",
      filename: module_,
      errors: [
        'passwordResetCode',
        'resetCode',
        'loginCodeResult',
        'resetCodeStatus',
        'errorLoginCode',
        'loginCodeErrorCode',
        'verification_code_result',
        'statusMfaCodes',
      ].map((name, index) => ({
        messageId: 'prohibitedValue',
        data: { name, kind: 'a one-time code' },
        line: index + 1,
      })),
    },
    {
      name: 'the raw input read through getRawInput, awaited or not',
      code: "logger.info(await opts.getRawInput());\nlogger.info({ raw: await getRawInput() });\nlogger.debug('in', opts.getRawInput());\nlogger.info(opts.getRawInput?.() ?? null);",
      filename: module_,
      errors: [
        { messageId: 'requestInput', data: { text: 'opts.getRawInput()' }, line: 1 },
        { messageId: 'requestInput', data: { text: 'getRawInput()' }, line: 2 },
        { messageId: 'requestInput', data: { text: 'opts.getRawInput()' }, line: 3 },
        { messageId: 'requestInput', data: { text: 'opts.getRawInput?.()' }, line: 4 },
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
