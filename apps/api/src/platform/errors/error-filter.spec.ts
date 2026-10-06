// T094 — the one error shape (FR-041, R-API-8, R-SEC-9, R-GENDER-2; contracts/kernel.md "Error shape").
//
// Whatever is thrown, one shape leaves: `{ code, message, details? }`. A database error, a provider
// error and an unhandled exception all become the same internal error with a generic message, so no
// stack trace, query text, internal path or database code reaches a client. A forbidden profile
// answers exactly as an absent one does: 404, never 403, with an identical body.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError, ForbiddenProfileError } from './domain-error.js';
import { mapError } from './error-filter.js';

const internals = [
  'SELECT',
  'teacher_profiles',
  'apps/api/src',
  'node_modules',
  'P2002',
  'at Object.',
  'ECONNREFUSED',
];

function expectNoInternals(body: unknown): void {
  const text = JSON.stringify(body);
  for (const fragment of internals) expect(text, fragment).not.toContain(fragment);
}

function expectOneShape(body: object): void {
  for (const key of Object.keys(body)) expect(['code', 'message', 'details']).toContain(key);
}

describe('one shape out (T094, FR-041)', () => {
  it('passes a domain error through as its code and safe message', () => {
    const mapped = mapError(new DomainError('CONFLICT', 'This slot is no longer available.'));

    expect(mapped.status).toBe(409);
    expect(mapped.body).toEqual({ code: 'CONFLICT', message: 'This slot is no longer available.' });
    expect(mapped.unexpected).toBe(false);
  });

  it('never carries a domain error’s cause, stack or extra fields', () => {
    const cause = new Error('SELECT * FROM teacher_profiles WHERE id = $1');
    const error = Object.assign(new DomainError('NOT_FOUND', 'Not found.', { cause }), {
      query: 'SELECT 1',
    });

    const { body } = mapError(error);

    expect(body).toEqual({ code: 'NOT_FOUND', message: 'Not found.' });
    expectNoInternals(body);
  });

  it('maps an unhandled exception to the internal error, with no stack, query or path', () => {
    const error = new Error(
      'insert into "teacher_profiles" failed: SELECT … at /srv/apps/api/src/modules/catalog/catalog.repository.ts:42',
    );

    const mapped = mapError(error);

    expect(mapped.status).toBe(500);
    expect(mapped.unexpected).toBe(true);
    expect(mapped.body.code).toBe('INTERNAL');
    expect(mapped.body.details).toBeUndefined();
    expectOneShape(mapped.body);
    expectNoInternals(mapped.body);
  });

  it('never returns a database or vendor code', () => {
    const databaseError = Object.assign(
      new Error('Unique constraint failed on the fields: (`email`)'),
      {
        code: 'P2002',
        meta: { target: ['email'], modelName: 'teacher_profiles' },
        clientVersion: '7.10.0',
      },
    );
    const providerError = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:443'), {
      code: 'ECONNREFUSED',
    });

    for (const error of [databaseError, providerError]) {
      const mapped = mapError(error);
      expect(mapped.body.code).toBe('INTERNAL');
      expectNoInternals(mapped.body);
    }
  });

  it('maps anything thrown that is not an Error', () => {
    for (const thrown of ['SELECT 1', { sql: 'SELECT 1' }, null, undefined, 42]) {
      const mapped = mapError(thrown);
      expect(mapped.status).toBe(500);
      expect(mapped.body.code).toBe('INTERNAL');
      expectNoInternals(mapped.body);
    }
  });

  it('maps a validation failure to field-level details only, never the value sent', () => {
    const schema = z.object({ email: z.email(), age: z.number().int() });
    const parsed = schema.safeParse({ email: 'not-an-email-SELECT', age: 'teacher_profiles' });
    if (parsed.success) throw new Error('expected the parse to fail');

    const mapped = mapError(parsed.error);

    expect(mapped.status).toBe(400);
    expect(mapped.unexpected).toBe(false);
    expect(mapped.body.code).toBe('VALIDATION_FAILED');
    expect(mapped.body.details?.map((issue) => issue.path).sort()).toEqual(['age', 'email']);
    expectOneShape(mapped.body);
    expect(JSON.stringify(mapped.body)).not.toContain('not-an-email');
    expectNoInternals(mapped.body);
  });
});

describe('a forbidden profile is indistinguishable from an absent one (T094, R-GENDER-2)', () => {
  it('answers 404 with the very body an absent profile gets, never 403', () => {
    const forbidden = mapError(new ForbiddenProfileError());
    const absent = mapError(new DomainError('NOT_FOUND'));

    expect(forbidden.status).toBe(404);
    expect(forbidden.status).not.toBe(403);
    expect(forbidden).toEqual(absent);
  });
});
