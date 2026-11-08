// T016 of specs/004-sessions (FR-445, FR-480; R-TIME-6; research R-307) — the administrator
// surface's `sessions.outages` procedures as they are served (admin-surface.md, "`sessions`"). Each
// is the administrator kind (an anonymous caller and an unverified second factor refused, nothing
// reached or written); the record takes local wall clocks and a zone, never an instant, and a
// mandatory reason, audited `provider_outage.recorded` on the window with the reason; the list is
// audited `provider_outages.listed` on the reader. What the record does is
// `outages.service.spec.ts`' and `tests/db-integrity/outages.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { sessionsAdminRouter } from './sessions-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ sessions: sessionsAdminRouter }));

const OUTAGE = '0199d0a0-0000-7000-8000-0000000000c1';
const RECORDED = {
  outageId: OUTAGE,
  startsAt: '2026-11-08T08:00:00.000Z',
  endsAt: '2026-11-08T09:30:00.000Z',
  reclassified: 2,
};
const PAGE = {
  items: [
    {
      outageId: OUTAGE,
      startsAt: '2026-11-08T08:00:00.000Z',
      endsAt: '2026-11-08T09:30:00.000Z',
      reason: 'انقطاع لدى المزود',
      recordedBy: { adminId: SPEC_ADMIN, displayName: 'Spec admin' },
    },
  ],
};
const INPUT = {
  start: { localDate: '2026-11-08', localTime: '10:00' },
  end: { localDate: '2026-11-08', localTime: '11:30' },
  timezone: 'Africa/Cairo',
  reason: 'انقطاع لدى المزود',
};

function surface() {
  const reached: unknown[][] = [];
  const outages: AdminSurfaceServices['outages'] = {
    record: async (_tx, adminId, input) => {
      reached.push(['record', adminId, input]);
      return RECORDED;
    },
    list: async (_tx, input) => {
      reached.push(['list', input]);
      return PAGE;
    },
  };
  const contexts = adminContextsOver({ outages });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('the administrator kind', () => {
  it('sessions.outages.record refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(null).sessions.outages.record(INPUT))).toBe('UNAUTHENTICATED');
    expect(
      await codeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.outages.record(INPUT)),
    ).toBe('MFA_REQUIRED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('sessions.outages.list refuses an anonymous caller and an unverified second factor, writing nothing', async () => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(null).sessions.outages.list({}))).toBe('UNAUTHENTICATED');
    expect(await codeOf(as({ ...VERIFIED, mfaVerified: false }).sessions.outages.list({}))).toBe(
      'MFA_REQUIRED',
    );
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.outages.record (FR-445, R-TIME-6)', () => {
  it('records the window with the actor and audits provider_outage.recorded on it with the reason', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).sessions.outages.record(INPUT)).toEqual(RECORDED);
    expect(reached).toEqual([['record', SPEC_ADMIN, INPUT]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'provider_outage.recorded',
        targetType: 'provider_outage',
        targetId: OUTAGE,
        reason: INPUT.reason,
      },
    ]);
  });

  it.each([
    ['a blank reason', { ...INPUT, reason: ' ' }],
    ['no reason', { ...INPUT, reason: undefined }],
    ['an instant in place of a wall clock', { ...INPUT, start: '2026-11-08T08:00:00Z' }],
    ['a time with seconds', { ...INPUT, end: { localDate: '2026-11-08', localTime: '11:30:00' } }],
    ['no zone', { ...INPUT, timezone: undefined }],
  ])('refuses %s VALIDATION_FAILED, reaching and writing nothing', async (_name, input) => {
    const { as, written, reached } = surface();
    expect(
      await codeOf(as(VERIFIED).sessions.outages.record(input as unknown as typeof INPUT)),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

describe('sessions.outages.list', () => {
  it('lists a page and audits provider_outages.listed on the reader', async () => {
    const { as, written, reached } = surface();
    const answer = await as(VERIFIED).sessions.outages.list({ cursor: OUTAGE });
    expect(answer).toEqual(PAGE);
    expect(reached).toEqual([['list', { cursor: OUTAGE }]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'provider_outages.listed',
        targetType: 'admin',
        targetId: SPEC_ADMIN,
      },
    ]);
  });
});
