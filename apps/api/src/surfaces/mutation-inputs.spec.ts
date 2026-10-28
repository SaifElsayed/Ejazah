// T099 — no mutation on either surface may be sent without a body. tRPC 11.19's client sends a
// mutation whose input is `undefined` with no body, and its server cannot read a mutation without
// one (500 INTERNAL before the procedure runs). `mutationsSentWithoutBody` walks a router and names
// every mutation whose input accepts `undefined`; these cases drive it over fixture routers in both
// directions, then over the two real surfaces, which must hold none.
import { adminEmptyInput } from '@ijazah/contracts/admin';
import { emptyInput } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { adminRouter } from './admin.router.js';
import { appRouter } from './app.router.js';
import { mutationsSentWithoutBody } from './mutation-inputs.js';
import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
  studentProcedure,
} from './procedures.js';

const anyone = { key: 'rate_limit_search', subjectOf: () => 'anyone' } as const;

describe('a mutation the client would send without a body is named (T099)', () => {
  it('names a void mutation and an optional one on the user surface, with the reason', async () => {
    const router = createAppRouter({
      nonce: publicProcedure({ input: z.void(), output: z.string(), rateLimit: anyone }).mutation(
        () => 'nonce',
      ),
      maybe: studentProcedure({
        input: z.object({ note: z.string() }).optional(),
        output: z.void(),
      }).mutation(() => undefined),
    });
    expect(await mutationsSentWithoutBody(router)).toEqual([
      'maybe: its input accepts undefined, so the client sends it with no body and the server cannot read it (T099)',
      'nonce: its input accepts undefined, so the client sends it with no body and the server cannot read it (T099)',
    ]);
  });

  it('names a void mutation on the administrator surface', async () => {
    const router = createAdminRouter({
      signOut: adminProcedure({ input: z.void(), output: z.void() }).mutation(() => undefined),
    });
    expect(await mutationsSentWithoutBody(router)).toEqual([
      'signOut: its input accepts undefined, so the client sends it with no body and the server cannot read it (T099)',
    ]);
  });

  it('passes a mutation taking the empty input, one taking fields, and a void query, on both surfaces', async () => {
    const user = createAppRouter({
      nonce: publicProcedure({ input: emptyInput, output: z.string(), rateLimit: anyone }).mutation(
        () => 'nonce',
      ),
      hold: studentProcedure({
        input: z.object({ slotId: z.string() }),
        output: z.void(),
      }).mutation(() => undefined),
      me: studentProcedure({ input: z.void(), output: z.string() }).query(() => 'me'),
    });
    const administrator = createAdminRouter({
      signOut: adminProcedure({ input: adminEmptyInput, output: z.void() }).mutation(
        () => undefined,
      ),
      me: adminProcedure({ input: z.void(), output: z.string() }).query(() => 'me'),
    });
    expect(await mutationsSentWithoutBody(user)).toEqual([]);
    expect(await mutationsSentWithoutBody(administrator)).toEqual([]);
  });

  it('refuses the empty input’s undefined and its extra fields, and reads `{}`', () => {
    for (const schema of [emptyInput, adminEmptyInput]) {
      expect(schema.safeParse(undefined).success).toBe(false);
      expect(schema.safeParse({ extra: 1 }).success).toBe(false);
      expect(schema.parse({})).toEqual({});
    }
  });
});

describe('the real surfaces (T099)', () => {
  it('holds no mutation the client would send without a body on the user surface', async () => {
    expect(await mutationsSentWithoutBody(appRouter)).toEqual([]);
  });

  it('holds no mutation the client would send without a body on the administrator surface', async () => {
    expect(await mutationsSentWithoutBody(adminRouter)).toEqual([]);
  });
});
