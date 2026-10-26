// T077 — the `teacher.payout` namespace as the user surface serves it (app-surface.md
// "`teacher.payout` — payout setup"; FR-190 to FR-194, R-106).
//
// Both procedures are the teacher kind admitting an approved teacher: an anonymous caller is
// UNAUTHENTICATED, a student and an applicant FORBIDDEN, a suspended or banned teacher
// ACCOUNT_RESTRICTED, and none of them reaches the service. An approved teacher is admitted whether
// the payout account is verified or not, since this is where it is set up and replaced (FR-193).
// The authorization gate (T028, R-MOBILE-13) reads these cases by path. What the service answers is
// payout.service.spec.ts's.
import { beforeEach, describe, expect, it } from 'vitest';

import { toErrorShape } from '../../surfaces/procedures.js';

import {
  metaOf,
  PAYOUT_CALLER,
  type PayoutCaller,
  payoutSurfaceOf,
  recordingPayout,
} from './__fixtures__/payout-surface.js';

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const KEY = 'spec-payout-key-0001';
const DETAILS = {
  holderName: 'Spec Teacher',
  method: 'bank_account',
  accountNumber: 'EG380019000500000000263180002',
} as const;

let services: ReturnType<typeof recordingPayout>;
let surface: ReturnType<typeof payoutSurfaceOf>;
beforeEach(() => {
  services = recordingPayout();
  surface = payoutSurfaceOf(services.payout);
});

function calls(caller: PayoutCaller) {
  return {
    'teacher.payout.get': () => caller.teacher.payout.get(),
    'teacher.payout.register': () =>
      caller.teacher.payout.register({ details: DETAILS, idempotencyKey: KEY }),
  };
}

describe('the namespace', () => {
  it('declares both procedures as the teacher kind, neither of them limited', () => {
    for (const path of Object.keys(calls(surface.anonymous()))) {
      expect(metaOf(path)).toEqual({ surface: 'app', caller: 'teacher' });
    }
  });

  it("refuses an anonymous caller UNAUTHENTICATED: 'teacher.payout.get', 'teacher.payout.register'", async () => {
    for (const [path, call] of Object.entries(calls(surface.anonymous()))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses a student FORBIDDEN: 'teacher.payout.get', 'teacher.payout.register'", async () => {
    for (const [path, call] of Object.entries(calls(surface.as('student')))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses an applicant FORBIDDEN, since payout setup follows approval: 'teacher.payout.get', 'teacher.payout.register'", async () => {
    for (const [path, call] of Object.entries(calls(surface.as('applicant')))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED: 'teacher.payout.get', 'teacher.payout.register'", async () => {
    for (const standing of ['suspended teacher', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(calls(surface.as(standing)))) {
        await expect(call(), path).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(services.calls).toEqual([]);
  });

  it('admits an approved teacher, verified or not, on the caller’s own id, and answers what the contract names', async () => {
    for (const standing of ['approved', 'publishable'] as const) {
      const caller = surface.as(standing);
      await expect(caller.teacher.payout.get()).resolves.toEqual({
        state: 'pending_verification',
        configuredAt: '2026-10-26T09:00:00.000Z',
      });
      await expect(
        caller.teacher.payout.register({ details: DETAILS, idempotencyKey: KEY }),
      ).resolves.toBeUndefined();
    }
    const reached = [
      ['payout.get', PAYOUT_CALLER],
      ['payout.register', PAYOUT_CALLER, { details: DETAILS, idempotencyKey: KEY }],
    ];
    expect(services.calls).toEqual([...reached, ...reached]);
  });

  it('refuses details outside the provisional shape VALIDATION_FAILED, naming the field and never its value', async () => {
    const caller = surface.as('approved');
    const malformed = 'EG38-0019-0005';
    const error: unknown = await caller.teacher.payout
      .register({ details: { ...DETAILS, accountNumber: malformed }, idempotencyKey: KEY })
      .catch((thrown: unknown) => thrown);
    const shape = toErrorShape(error as Parameters<typeof toErrorShape>[0]);
    expect(shape).toMatchObject({
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        details: [{ path: 'details.accountNumber', code: 'invalid_format' }],
      },
    });
    expect(JSON.stringify(shape)).not.toContain(malformed);

    const missingKey: unknown = await caller.teacher.payout
      .register({ details: DETAILS } as never)
      .catch((thrown: unknown) => thrown);
    expect(toErrorShape(missingKey as Parameters<typeof toErrorShape>[0]).body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'idempotencyKey' }],
    });
    expect(services.calls).toEqual([]);
  });
});
