// T149 — the HTTP application mounts the two surfaces apart, and every response it sends, on either
// surface or outside both, is the kernel's one error shape (FR-048, FR-041, R-API-11, R-SEC-9;
// contracts/kernel.md "Two surfaces", "Error shape").
//
// The application is built as main.ts builds it, but over fixture routers holding a procedure of
// each kind, since the real routers are still empty, and listened on an ephemeral port. Every case
// is a real HTTP request: a procedure answers only on its own surface's path, the caller kinds
// answer 401 and 400 through the transport, an unexpected failure leaves as the internal error with
// nothing of its text, and a path outside both surfaces gets the same shape rather than the
// framework's own.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApplication, surfacePaths } from './app.module.js';
import { createLogger } from './platform/logging/logger.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
  studentProcedure,
} from './surfaces/procedures.js';

const secret = 'SELECT password_hash FROM admin_users -- 7f3e';

const user = createAppRouter({
  ping: publicProcedure(z.void()).query(() => 'pong'),
  echo: publicProcedure(z.object({ n: z.number() })).query(({ input }) => input.n),
  boom: publicProcedure(z.void()).query(() => {
    throw new Error(secret);
  }),
  me: studentProcedure(z.void()).query(({ ctx }) => ctx.caller.userId),
});

const administrator = createAdminRouter({
  approve: adminProcedure(z.object({ teacherId: z.string() })).mutation(() => 'approved'),
});

const records: string[] = [];
let application: INestApplication;
let origin: string;

beforeAll(async () => {
  const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });
  application = await createApplication({ log, surfaces: { app: user, admin: administrator } });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

async function query(path: string, input?: unknown): Promise<{ status: number; body: unknown }> {
  const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await fetch(`${origin}${path}${search}`);
  return { status: response.status, body: await response.json() };
}

async function mutate(path: string, input: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}

const notFound = { error: { code: 'NOT_FOUND', message: 'Not found.' } };

describe('the HTTP application (T149)', () => {
  it('mounts the two surfaces on two different paths', () => {
    expect(surfacePaths.app).not.toBe(surfacePaths.admin);
    expect(surfacePaths.admin.startsWith(`${surfacePaths.app}/`)).toBe(false);
    expect(surfacePaths.app.startsWith(`${surfacePaths.admin}/`)).toBe(false);
  });

  it('serves a user procedure on the user surface only', async () => {
    expect(await query(`${surfacePaths.app}/ping`)).toEqual({
      status: 200,
      body: { result: { data: 'pong' } },
    });
    expect(await query(`${surfacePaths.admin}/ping`)).toEqual({ status: 404, body: notFound });
  });

  it('serves an administrator procedure on the administrator surface only', async () => {
    expect(await mutate(`${surfacePaths.admin}/approve`, { teacherId: 't1' })).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    });
    expect(await mutate(`${surfacePaths.app}/approve`, { teacherId: 't1' })).toEqual({
      status: 404,
      body: notFound,
    });
  });

  it('answers a caller kind refusal and a validation failure with their status and shape', async () => {
    expect(await query(`${surfacePaths.app}/me`)).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
    });
    expect(await query(`${surfacePaths.app}/echo`, { n: 'seven' })).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request is not valid.',
          details: [{ path: 'n', code: 'invalid_type' }],
        },
      },
    });
  });

  it('sends an unexpected failure as the internal error, and logs it with its correlation id', async () => {
    const { status, body } = await query(`${surfacePaths.app}/boom`);
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Try again later.' },
    });
    expect(JSON.stringify(body)).not.toContain('password_hash');

    const logged = records.map((line) => JSON.parse(line) as Record<string, unknown>);
    const failure = logged.find((record) => record['level'] === 'error');
    expect(failure?.['correlationId']).toEqual(expect.any(String));
  });

  it('answers a path outside both surfaces with the same shape, not the framework one', async () => {
    expect(await query('/elsewhere')).toEqual({ status: 404, body: notFound });
  });
});
