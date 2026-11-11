// T059 of specs/004-sessions/tasks.md (SRS FR-DISPUTE-7; FR-439, FR-472; research R-308, R-323
// GAP-3; contracts/kernel.md, the revision's and the correction's rows; the notes under T059, Q1 (a)
// and F2) — `createRevisions` over a recorded store and a recorded idempotency service. Each call is
// keyed through `runOn` on the call's transaction before any lock, its input hashed without the
// key; a replay answers the stored result and runs nothing. The revision locks the enrollment, the
// session, then the dispute, reads them again, and writes the session's outcome only, with one
// `dispute_revised` row naming the dispute; `notUndone` names a `party_*` ruling and an enrollment
// no longer confirmed. The correction locks the enrollment then the session and writes one
// `outcome_corrected` row. Each refusal is logged once and writes nothing. Over the real tables:
// `tests/db-integrity/ruling-revision.spec.ts`.
import type { SessionStatus } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { SessionDisputeRow } from '../moderation/index.js';
import type { AdminOutcomeWrite } from './admin-outcome.service.js';
import { createRevisions, type RevisionStore } from './revision.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const LATER = '0199d0a0-0000-7000-8000-0000000000d2';
const KEY = 'spec-revise-key-0001';
const END = new Date('2026-11-08T10:00:00Z');
const INSIDE = new Date('2026-11-09T10:00:00Z');
const PAST = new Date('2026-11-11T10:00:00Z');
const REVISE = {
  disputeId: DISPUTE,
  outcome: 'done' as const,
  reason: 'خطأ في الحكم',
  idempotencyKey: KEY,
};
const CORRECT = {
  sessionId: SESSION,
  outcome: 'both_no_show' as const,
  reason: 'خطأ',
  idempotencyKey: KEY,
};

const disputeRow = (
  id: string,
  status: SessionDisputeRow['status'],
  resolution: SessionDisputeRow['resolution'] = status === 'resolved' ? 'upheld' : null,
): SessionDisputeRow => ({
  id,
  enrollmentId: ENROLLMENT,
  sessionId: SESSION,
  raisedByUserId: null,
  reason: 'سبب',
  status,
  createdAt: new Date('2026-11-08T11:00:00Z'),
  resolution,
  resolutionNotes: status === 'resolved' ? 'ملاحظة' : null,
  resolvedAt: status === 'resolved' ? new Date('2026-11-08T12:00:00Z') : null,
});

interface World {
  readonly status?: SessionStatus;
  readonly disputes?: readonly SessionDisputeRow[];
  readonly hasRemedy?: boolean;
  readonly now?: Date;
  readonly enrollmentStatus?: 'confirmed' | 'cancelled';
  readonly replay?: unknown;
  readonly session?: boolean;
}

function world({
  status = 'teacher_no_show',
  disputes = [disputeRow(DISPUTE, 'resolved')],
  hasRemedy = false,
  now = INSIDE,
  enrollmentStatus = 'confirmed',
  replay,
  session = true,
}: World = {}) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  const written: AdminOutcomeWrite[] = [];
  const store: RevisionStore = {
    disputeOf: async (_tx, id) => disputes.find((row) => row.id === id) ?? null,
    disputesOfSession: async () => disputes,
    sessionToRevise: async () =>
      session
        ? { id: SESSION, enrollmentId: ENROLLMENT, status, scheduledEndAt: END, hasRemedy }
        : null,
    revisionsOf: async () => [],
    lockSessions: async (_tx, ids) => {
      journal.push(`lock sessions ${ids.join(',')}`);
    },
    lockDispute: async (_tx, id) => {
      journal.push(`lock disputes ${id}`);
    },
    writeOutcome: async (_tx, write) => {
      journal.push(`write ${write.from}->${write.outcome} ${write.event.kind}`);
      written.push(write);
    },
  };
  const settings: SettingsReader = {
    read: async (key) => {
      expect(key).toBe('dispute_window_hours');
      return 72 as never;
    },
  };
  const service = createRevisions({
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        journal.push(`lock enrollments ${ids.join(',')}`);
      },
      enrollmentFor: async () =>
        ({ status: enrollmentStatus }) as Awaited<
          ReturnType<Parameters<typeof createRevisions>[0]['enrollments']['enrollmentFor']>
        >,
    },
    idempotency: {
      runOn: async (keyedTx, request, effect) => {
        journal.push(`key ${request.scope} ${request.actorId} ${JSON.stringify(request.input)}`);
        expect(request.key).toBe(KEY);
        if (replay !== undefined) return { outcome: replay as never, replayed: true };
        return { outcome: await effect(keyedTx), replayed: false };
      },
    },
    settings,
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Parameters<typeof createRevisions>[0]['log'],
    clock: async () => now,
    store,
  });
  return { service, journal, logged, written };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  expect(isRefusalLogged(thrown), `${thrown.code} marked «logged»`).toBe(true);
  return thrown;
}

const REVISE_KEY = `key disputes.revise ${ADMIN} ${JSON.stringify({ disputeId: DISPUTE, outcome: 'done', reason: REVISE.reason })}`;
const REVISE_LOCKS = [
  `lock enrollments ${ENROLLMENT}`,
  `lock sessions ${SESSION}`,
  `lock disputes ${DISPUTE}`,
];

describe('disputes.revise (FR-472)', () => {
  it('keys first, locks the enrollment, the session and the dispute, then writes the outcome and one dispute_revised row', async () => {
    const { service, journal, written, logged } = world();
    expect(await service.reviseRuling(tx, ADMIN, REVISE)).toEqual({
      outcome: {
        disputeId: DISPUTE,
        sessionStatus: 'done',
        previousStatus: 'teacher_no_show',
        notUndone: [],
      },
      replayed: false,
    });
    expect(journal).toEqual([
      REVISE_KEY,
      ...REVISE_LOCKS,
      'write teacher_no_show->done dispute_revised',
    ]);
    expect(written[0]).toEqual({
      sessionId: SESSION,
      enrollmentId: ENROLLMENT,
      from: 'teacher_no_show',
      outcome: 'done',
      adminId: ADMIN,
      at: INSIDE,
      event: { kind: 'dispute_revised', disputeId: DISPUTE, outcomeBefore: 'teacher_no_show' },
    });
    expect(logged).toEqual([
      {
        fields: {
          adminId: ADMIN,
          disputeId: DISPUTE,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          previousStatus: 'teacher_no_show',
          sessionStatus: 'done',
        },
        message: 'A dispute ruling was revised',
      },
    ]);
  });

  it.each(['party_suspended', 'party_banned'] as const)(
    'names a %s ruling and an ended enrollment in notUndone, undoing neither',
    async (resolution) => {
      const { service, journal } = world({
        disputes: [disputeRow(DISPUTE, 'resolved', resolution)],
        enrollmentStatus: 'cancelled',
      });
      const { outcome } = await service.reviseRuling(tx, ADMIN, REVISE);
      expect(outcome.notUndone).toEqual([resolution, 'enrollment_ended']);
      expect(journal.filter((line) => line.startsWith('standing'))).toEqual([]);
    },
  );

  it('answers a replay from the key’s row, running nothing', async () => {
    const stored = {
      disputeId: DISPUTE,
      sessionStatus: 'done',
      previousStatus: 'done',
      notUndone: [],
    };
    const { service, journal, written } = world({ replay: stored });
    expect(await service.reviseRuling(tx, ADMIN, REVISE)).toEqual({
      outcome: stored,
      replayed: true,
    });
    expect(journal).toEqual([REVISE_KEY]);
    expect(written).toEqual([]);
  });

  it.each<[string, World, string, string | undefined]>([
    [
      'an outage reclassification',
      { status: 'provider_outage' },
      'SESSION_UNDER_REVIEW',
      undefined,
    ],
    [
      'this dispute open',
      { status: 'disputed', disputes: [disputeRow(DISPUTE, 'open')] },
      'DISPUTE_OPEN',
      undefined,
    ],
    [
      'another dispute open',
      {
        status: 'disputed',
        disputes: [disputeRow(DISPUTE, 'resolved'), disputeRow(LATER, 'open')],
      },
      'DISPUTE_OPEN',
      undefined,
    ],
    ['the window closed', { now: PAST }, 'RULING_FINAL', 'window_closed'],
    ['a remedy existing', { hasRemedy: true }, 'RULING_FINAL', 'remedy_offered'],
    [
      'a later ruling',
      { disputes: [disputeRow(DISPUTE, 'resolved'), disputeRow(LATER, 'resolved')] },
      'RULING_SUPERSEDED',
      undefined,
    ],
  ])(
    'refuses %s, under the locks, writing nothing, logged once',
    async (_name, given, code, cause) => {
      const { service, journal, written, logged } = world(given);
      const refused = await refusalOf(service.reviseRuling(tx, ADMIN, REVISE));
      expect(refused.code).toBe(code);
      expect(refused.details).toEqual(
        cause === undefined ? undefined : [{ path: 'cause', code: cause }],
      );
      expect(journal).toEqual([REVISE_KEY, ...REVISE_LOCKS]);
      expect(written).toEqual([]);
      expect(logged).toEqual([
        {
          fields: {
            adminId: ADMIN,
            disputeId: DISPUTE,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            errorCode: code,
            ...(cause === undefined ? {} : { cause }),
          },
          message: 'A ruling revision was refused',
        },
      ]);
    },
  );

  it('refuses no session dispute NOT_FOUND before any lock', async () => {
    const { service, journal, logged } = world({ disputes: [] });
    expect((await refusalOf(service.reviseRuling(tx, ADMIN, REVISE))).code).toBe('NOT_FOUND');
    expect(journal).toEqual([REVISE_KEY]);
    expect(logged).toHaveLength(1);
  });
});

const CORRECT_KEY = `key sessions.review.revise ${ADMIN} ${JSON.stringify({ sessionId: SESSION, outcome: 'both_no_show', reason: CORRECT.reason })}`;
const CORRECT_LOCKS = [`lock enrollments ${ENROLLMENT}`, `lock sessions ${SESSION}`];

describe('sessions.review.revise (FR-439)', () => {
  it('keys first, locks the enrollment then the session, then writes the outcome and one outcome_corrected row', async () => {
    const { service, journal, written } = world({ status: 'done', disputes: [] });
    expect(await service.correctOutcome(tx, ADMIN, CORRECT)).toEqual({
      outcome: { sessionId: SESSION, sessionStatus: 'both_no_show', previousStatus: 'done' },
      replayed: false,
    });
    expect(journal).toEqual([
      CORRECT_KEY,
      ...CORRECT_LOCKS,
      'write done->both_no_show outcome_corrected',
    ]);
    expect(written[0]?.event).toEqual({ kind: 'outcome_corrected', outcomeBefore: 'done' });
    expect(written[0]?.at).toEqual(INSIDE);
  });

  it('answers a replay from the key’s row, running nothing', async () => {
    const stored = { sessionId: SESSION, sessionStatus: 'both_no_show', previousStatus: 'done' };
    const { service, journal, written } = world({ replay: stored, disputes: [] });
    expect(await service.correctOutcome(tx, ADMIN, CORRECT)).toEqual({
      outcome: stored,
      replayed: true,
    });
    expect(journal).toEqual([CORRECT_KEY]);
    expect(written).toEqual([]);
  });

  it.each<[string, World, string, readonly { path: string; code: string }[] | undefined]>([
    [
      'a scheduled session',
      { status: 'scheduled', disputes: [] },
      'CONFLICT',
      [{ path: 'cause', code: 'not_settled' }],
    ],
    [
      'a cancelled session',
      { status: 'cancelled_by_admin', disputes: [] },
      'CONFLICT',
      [{ path: 'cause', code: 'not_settled' }],
    ],
    [
      'a session under review',
      { status: 'under_threshold', disputes: [] },
      'SESSION_UNDER_REVIEW',
      undefined,
    ],
    [
      'a disputed session',
      { status: 'disputed', disputes: [disputeRow(DISPUTE, 'open')] },
      'DISPUTE_OPEN',
      undefined,
    ],
    [
      'the window closed',
      { status: 'done', disputes: [], now: PAST },
      'RULING_FINAL',
      [{ path: 'cause', code: 'window_closed' }],
    ],
    [
      'a remedy existing',
      { status: 'done', disputes: [], hasRemedy: true },
      'RULING_FINAL',
      [{ path: 'cause', code: 'remedy_offered' }],
    ],
    [
      'a resolved dispute, naming it',
      { status: 'done', disputes: [disputeRow(DISPUTE, 'resolved')] },
      'CONFLICT',
      [
        { path: 'cause', code: 'ruled' },
        { path: 'disputeId', code: DISPUTE },
      ],
    ],
  ])(
    'refuses %s, under the locks, writing nothing, logged once',
    async (_name, given, code, details) => {
      const { service, journal, written, logged } = world(given);
      const refused = await refusalOf(service.correctOutcome(tx, ADMIN, CORRECT));
      expect(refused.code).toBe(code);
      expect(refused.details).toEqual(details);
      expect(journal).toEqual([CORRECT_KEY, ...CORRECT_LOCKS]);
      expect(written).toEqual([]);
      expect(logged).toHaveLength(1);
      expect(logged[0]?.message).toBe('An outcome correction was refused');
    },
  );

  it('refuses a session that does not exist NOT_FOUND before any lock', async () => {
    const { service, journal } = world({ session: false });
    expect((await refusalOf(service.correctOutcome(tx, ADMIN, CORRECT))).code).toBe('NOT_FOUND');
    expect(journal).toEqual([CORRECT_KEY]);
  });
});

describe('disputes.get’s revisable (T059)', () => {
  it('reads the one rule with no lock: revisable inside the window, not past it', async () => {
    const inside = world();
    expect(await inside.service.revisionView(tx, disputeRow(DISPUTE, 'resolved'))).toEqual({
      revisable: true,
      revisions: [],
    });
    expect(inside.journal).toEqual([]);
    const past = world({ now: PAST });
    expect((await past.service.revisionView(tx, disputeRow(DISPUTE, 'resolved'))).revisable).toBe(
      false,
    );
  });
});
