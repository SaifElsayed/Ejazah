// T039 of specs/004-sessions/tasks.md — the `purge-chat` sweep (FR-492; SRS FR-SESS-13; ERD §6
// `chat_messages` and §15 rules 8 and 47; research R-314; contracts/kernel.md, the purge's row and
// its jobs row; the notes under T039).
//
// Over an in-memory store standing in for chat's queries and the three entries the purge reads
// (booking's statuses, sessions' scheduled ends, moderation's open matters), the transactions, the
// storage port, the database's clock and the log faked:
// - a daily sweep under its name, run with no payload;
// - nothing before the last session's scheduled end + `dispute_window_hours` + `chat_retention_days`,
//   by the database's clock; at that instant, every message's body, attachment name and type NULL
//   and `purged_at` set, the key kept until its file is removed after the commit, then cleared;
// - only a `completed`, `terminated_no_show` or `cancelled` enrollment, and none with an open matter
//   (a dispute, a case or a complaint: the kinds are the database spec's, over the real `disputes`);
// - the enrollment's lock first, then everything read again under it: a matter opened after the
//   page was read is seen and the chat is kept (F13);
// - twice = once: the same rows purged, each file removed once, a missing file not an error;
// - the lines: one `info` `{ enrollmentId, messages, files }` per enrollment purged, one `warn`
//   `{ messageId }` per removal that failed, none for an enrollment not purged, never a body, a file
//   name or a storage key; a later run removing the held-back files writes `{ enrollmentId,
//   messages: 0, files }` (Q2 (a));
// - each enrollment's failure caught on its own, and every read paged;
// - (005:T012; FR-492, SRS FR-SESS-13; the note under T012, Q-R1 (a)) the store's open matters are
//   the union of moderation's two reads: an open `user_reports` row on the enrollment keeps its chat
//   as an open `disputes` row does, an actioned or dismissed one does not, one raised before the
//   lock is granted is seen; read through the store's own binding over the transaction's delegates.
// Written before the job and the module's purge, and run red first.
import { describe, expect, it } from 'vitest';

import { type ChatPurgeStore, chatPurgeStore, type HeldChatFile } from '../modules/chat/index.js';
import type { Transaction } from '../platform/db/prisma.repository.js';
import type { SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import { scheduleSweeps } from './queue.js';
import { PURGE_CHAT, PURGE_CHAT_PAGE_SIZE, PURGE_CHAT_SCHEDULE, purgeChat } from './purge-chat.js';

type Status = 'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';

interface EnrollmentState {
  status: Status;
  lastEnd: Date | null;
  open: boolean;
}

interface Row {
  readonly id: string;
  readonly enrollmentId: string;
  body: string | null;
  key: string | null;
  filename: string | null;
  mime: string | null;
  purgedAt: Date | null;
}

/** The last session's scheduled end, and that instant + 48 hours + 30 days. */
const LAST_END = new Date('2026-10-01T07:00:00.000Z');
const DUE = new Date('2026-11-02T07:00:00.000Z');
const JUST_BEFORE = new Date('2026-11-02T06:59:59.999Z');

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'dispute_window_hours') return schema.parse(48);
    if (key === 'chat_retention_days') return schema.parse(30);
    throw new Error(`spec settings: no ${key}`);
  },
};

const text = (id: string, enrollmentId: string): Row => ({
  id,
  enrollmentId,
  body: `body of ${id}`,
  key: null,
  filename: null,
  mime: null,
  purgedAt: null,
});

const file = (id: string, enrollmentId: string): Row => ({
  id,
  enrollmentId,
  body: null,
  key: `chat/${enrollmentId}/${id}`,
  filename: `${id}.pdf`,
  mime: 'application/pdf',
  purgedAt: null,
});

/** A `disputes` or `user_reports` row as moderation's reads see it (a profile report has no enrollment). */
interface Matter {
  readonly enrollmentId: string | null;
  readonly status: 'open' | 'actioned' | 'dismissed';
}

/** A delegate's `findMany` over `rows()`, honouring the `enrollmentId: { in }` and `status` given. */
const findManyOver = (rows: () => readonly Matter[]) => ({
  findMany: async ({ where }: { where: { enrollmentId: { in: string[] }; status?: string } }) =>
    rows()
      .filter(
        ({ enrollmentId, status }) =>
          enrollmentId !== null &&
          where.enrollmentId.in.includes(enrollmentId) &&
          (where.status === undefined || status === where.status),
      )
      .map(({ enrollmentId }) => ({ enrollmentId })),
});

interface Line {
  readonly level: 'info' | 'warn' | 'error';
  readonly fields: Record<string, unknown>;
  readonly message: string;
}

interface WorldOptions {
  readonly enrollments: Record<string, Partial<EnrollmentState>>;
  readonly rows: readonly Row[];
  /** Keys whose removal throws. */
  readonly failing?: readonly string[];
  /** Keys with no stored object (a missing file). */
  readonly missing?: readonly string[];
  readonly now?: Date;
  readonly pageSize?: number;
  /** Runs when the enrollment's lock is taken, as a concurrent opening would just before it. */
  readonly onLock?: (
    enrollmentId: string,
    world: { readonly enrollments: Map<string, EnrollmentState>; readonly userReports: Matter[] },
  ) => void;
  /**
   * `user_reports` rows (005:T012). When given, the open matters are read through the store's own
   * binding (`chatPurgeStore.openMattersAmong`) over the transaction's `dispute` delegate (each
   * enrollment's `open`) and `userReport` delegate (these rows).
   */
  readonly userReports?: readonly Matter[];
  /** An enrollment whose purge throws inside its transaction. */
  readonly throwingOn?: string;
}

type World = ReturnType<typeof worldOf>;

function worldOf(options: WorldOptions) {
  const enrollments = new Map<string, EnrollmentState>(
    Object.entries(options.enrollments).map(([id, state]) => [
      id,
      { status: 'completed', lastEnd: LAST_END, open: false, ...state },
    ]),
  );
  const rows = options.rows.map((row) => ({ ...row }));
  const userReports = [...(options.userReports ?? [])];
  const keys = rows.flatMap(({ key }) => (key === null ? [] : [key]));
  const missing = new Set(options.missing ?? []);
  const storage = {
    objects: new Set(keys.filter((key) => !missing.has(key))),
    failing: new Set(options.failing ?? []),
    removed: [] as string[],
    async remove(key: string) {
      if (this.failing.has(key)) throw new Error('spec storage: unreachable');
      this.removed.push(key);
      this.objects.delete(key);
    },
  };
  const lines: Line[] = [];
  const writer =
    (level: Line['level']) =>
    (fields: unknown, message?: string): void =>
      void lines.push({ level, fields: fields as Record<string, unknown>, message: message ?? '' });
  const log = { info: writer('info'), warn: writer('warn'), error: writer('error') };
  const reports: Error[] = [];
  /** Each store call with the number of the transaction it ran on. */
  const calls: (readonly [number, string])[] = [];
  let transactionsOpened = 0;
  const txOf = (tx: Transaction): number => (tx as unknown as { n: number }).n;
  const byId = (left: { id: string }, right: { id: string }) => (left.id < right.id ? -1 : 1);

  const world = {
    enrollments,
    userReports,
    rows,
    storage,
    lines,
    reports,
    calls,
    now: options.now ?? DUE,
  };

  const store: ChatPurgeStore = {
    async unpurgedEnrollmentsAfter(tx, after, limit) {
      calls.push([txOf(tx), 'page']);
      const ids = [
        ...new Set(rows.filter((row) => row.purgedAt === null).map((r) => r.enrollmentId)),
      ];
      return ids
        .sort()
        .filter((id) => after === undefined || id > after)
        .slice(0, limit);
    },
    async lockEnrollment(tx, enrollmentId) {
      calls.push([txOf(tx), 'lock']);
      options.onLock?.(enrollmentId, world);
    },
    async statusesAmong(tx, ids) {
      calls.push([txOf(tx), 'statuses']);
      return new Map(
        ids.flatMap((id) => {
          const state = enrollments.get(id);
          return state === undefined ? [] : [[id, state.status] as const];
        }),
      );
    },
    async lastScheduledEndsAmong(tx, ids) {
      calls.push([txOf(tx), 'ends']);
      return new Map(
        ids.flatMap((id) => {
          const end = enrollments.get(id)?.lastEnd ?? null;
          return end === null ? [] : [[id, end] as const];
        }),
      );
    },
    async openMattersAmong(tx, ids) {
      calls.push([txOf(tx), 'matters']);
      if (options.userReports !== undefined) return chatPurgeStore.openMattersAmong(tx, ids);
      return new Set(ids.filter((id) => enrollments.get(id)?.open === true));
    },
    async purgeMessagesOf(tx, enrollmentId, at) {
      calls.push([txOf(tx), 'purge']);
      if (enrollmentId === options.throwingOn) throw new Error('spec store: the update failed');
      const purged = rows.filter(
        (row) => row.enrollmentId === enrollmentId && row.purgedAt === null,
      );
      for (const row of purged) {
        row.body = null;
        row.filename = null;
        row.mime = null;
        row.purgedAt = at;
      }
      return {
        messages: purged.length,
        files: purged.flatMap(({ id, key }) =>
          key === null ? [] : [{ messageId: id, enrollmentId, storageKey: key }],
        ),
      };
    },
    async heldFilesAfter(tx, after, limit) {
      calls.push([txOf(tx), 'held']);
      return rows
        .filter((row) => row.purgedAt !== null && row.key !== null)
        .sort((left, right) =>
          left.enrollmentId === right.enrollmentId
            ? byId(left, right)
            : left.enrollmentId < right.enrollmentId
              ? -1
              : 1,
        )
        .filter(
          ({ id, enrollmentId }) =>
            after === undefined ||
            enrollmentId > after.enrollmentId ||
            (enrollmentId === after.enrollmentId && id > after.messageId),
        )
        .slice(0, limit)
        .map(({ id, enrollmentId, key }) => ({
          messageId: id,
          enrollmentId,
          storageKey: key ?? '',
        }));
    },
    async clearKey(tx, { messageId, storageKey }: HeldChatFile) {
      calls.push([txOf(tx), 'clear']);
      const row = rows.find(({ id }) => id === messageId);
      if (row === undefined || row.purgedAt === null || row.key !== storageKey) return false;
      row.key = null;
      return true;
    },
  };

  const job = purgeChat({
    transactions: {
      run: async (work) => {
        transactionsOpened += 1;
        const disputes = (): Matter[] =>
          [...enrollments].flatMap(([enrollmentId, { open }]) =>
            open ? [{ enrollmentId, status: 'open' as const }] : [],
          );
        return work({
          n: transactionsOpened,
          dispute: findManyOver(disputes),
          userReport: findManyOver(() => userReports),
        } as unknown as Transaction);
      },
    },
    settings,
    storage,
    log,
    report: (error) => void reports.push(error),
    clock: async () => world.now,
    store,
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
  });

  return { ...world, job, run: () => job.handle({}) };
}

/** What the run left: each row as plain data and each removal, for the double-run comparison. */
function observed(world: World) {
  return {
    rows: world.rows.map((row) => ({ ...row, purgedAt: row.purgedAt?.toISOString() ?? null })),
    removed: [...world.storage.removed].sort(),
    lines: world.lines,
  };
}

describe('purge-chat: the sweep (T039, FR-492, R-314)', () => {
  it('is a daily sweep under its name, run with no payload, reading in pages', async () => {
    const { job } = worldOf({ enrollments: {}, rows: [] });
    expect(job.name).toBe(PURGE_CHAT);
    expect(PURGE_CHAT).toBe('purge-chat');
    expect(job.schedule).toBe(PURGE_CHAT_SCHEDULE);
    expect(PURGE_CHAT_SCHEDULE).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    expect(PURGE_CHAT_PAGE_SIZE).toBeGreaterThan(0);
    const registered: unknown[] = [];
    await scheduleSweeps(
      {
        upsertJobScheduler: async (id, repeat, template) => {
          registered.push({
            id,
            pattern: repeat.pattern,
            name: template.name,
            data: template.data,
          });
        },
      },
      [job],
    );
    expect(registered).toEqual([
      { id: 'purge-chat', pattern: PURGE_CHAT_SCHEDULE, name: 'purge-chat', data: {} },
    ]);
  });
});

describe('purge-chat: when (the last scheduled end + the dispute window + the retention)', () => {
  const rows = [text('m1', 'e1'), file('m2', 'e1')];

  it('nothing a millisecond before that instant, by the database’s clock', async () => {
    const world = worldOf({ enrollments: { e1: {} }, rows, now: JUST_BEFORE });
    await world.run();
    expect(world.rows).toEqual(rows);
    expect(world.storage.removed).toEqual([]);
    expect(world.lines).toEqual([]);
  });

  it('at that instant: body, file name and type NULL, purged_at the clock, the file removed and its key cleared', async () => {
    const world = worldOf({ enrollments: { e1: {} }, rows });
    await world.run();
    expect(world.rows).toEqual([
      { ...rows[0], body: null, purgedAt: DUE },
      { ...rows[1], key: null, filename: null, mime: null, purgedAt: DUE },
    ]);
    expect(world.storage.removed).toEqual(['chat/e1/m2']);
  });

  it('only a completed, terminated_no_show or cancelled enrollment', async () => {
    const world = worldOf({
      enrollments: {
        e1: { status: 'completed' },
        e2: { status: 'terminated_no_show' },
        e3: { status: 'cancelled' },
        e4: { status: 'confirmed' },
        e5: { status: 'pending_payment' },
      },
      rows: ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => text(`m-${id}`, id)),
    });
    await world.run();
    expect(
      world.rows.filter(({ purgedAt }) => purgedAt !== null).map((r) => r.enrollmentId),
    ).toEqual(['e1', 'e2', 'e3']);
  });

  it('nothing while a dispute, a case or a complaint is open on it', async () => {
    const world = worldOf({
      enrollments: { e1: { open: true }, e2: {} },
      rows: [text('m1', 'e1'), text('m2', 'e2')],
    });
    await world.run();
    expect(world.rows.find(({ id }) => id === 'm1')?.purgedAt).toBeNull();
    expect(world.rows.find(({ id }) => id === 'm2')?.purgedAt).toEqual(DUE);
  });

  it('an enrollment no ordinary read returns, or with no session, is left as it is', async () => {
    const world = worldOf({
      enrollments: { e2: { lastEnd: null } },
      rows: [text('m1', 'e1'), text('m2', 'e2')],
    });
    await world.run();
    expect(world.rows.every(({ purgedAt }) => purgedAt === null)).toBe(true);
    expect(world.lines).toEqual([]);
  });
});

describe('purge-chat: the enrollment’s lock first, then read again (F13, T005 rule 1)', () => {
  it('a matter opened after the page was read, before the lock was granted, keeps the chat', async () => {
    const world = worldOf({
      enrollments: { e1: {} },
      rows: [text('m1', 'e1')],
      onLock: (id, { enrollments }) => {
        const state = enrollments.get(id);
        if (state !== undefined) state.open = true;
      },
    });
    await world.run();
    expect(world.rows[0]?.purgedAt).toBeNull();
    expect(world.lines).toEqual([]);
  });

  it('in the purge’s transaction the lock comes first, every condition is read after it, then the update', async () => {
    const world = worldOf({ enrollments: { e1: {} }, rows: [text('m1', 'e1')] });
    await world.run();
    const [purgeTx] = world.calls.filter(([, name]) => name === 'purge').map(([tx]) => tx);
    const inPurgeTx = world.calls.filter(([tx]) => tx === purgeTx).map(([, name]) => name);
    expect(inPurgeTx[0]).toBe('lock');
    expect(inPurgeTx.at(-1)).toBe('purge');
    expect([...inPurgeTx].sort()).toEqual(['ends', 'lock', 'matters', 'purge', 'statuses']);
  });
});

describe('purge-chat: twice = once (R-API-14; contracts/kernel.md, jobs)', () => {
  it('the same rows purged, each file removed once, a missing file not an error', async () => {
    const build = () =>
      worldOf({
        enrollments: { e1: {}, e2: { status: 'cancelled' }, e3: { status: 'confirmed' } },
        rows: [text('m1', 'e1'), file('m2', 'e1'), file('m3', 'e2'), file('m4', 'e3')],
        missing: ['chat/e2/m3'],
      });
    const { once, twice } = await runOnceAndTwice({
      world: build,
      run: (world) => world.run(),
      observe: observed,
    });
    expect(twice).toEqual(once);
    const single = build();
    await single.run();
    expect([...single.storage.removed].sort()).toEqual(['chat/e1/m2', 'chat/e2/m3']);
    expect(single.rows.find(({ id }) => id === 'm3')?.key).toBeNull();
    expect(single.lines.filter(({ level }) => level !== 'info')).toEqual([]);
    expect(single.reports).toEqual([]);
  });
});

describe('purge-chat: the lines (the owner’s decision of 2026-11-06; Q2 (a))', () => {
  it('one info line per enrollment purged, exactly { enrollmentId, messages, files }; none for one not purged', async () => {
    const rows = [
      text('m1', 'e1'),
      file('m2', 'e1'),
      file('m3', 'e1'),
      text('m4', 'e2'),
      text('m5', 'e3'),
      text('m6', 'e4'),
    ];
    const world = worldOf({
      enrollments: {
        e1: {},
        e2: { status: 'terminated_no_show' },
        e3: { open: true },
        e4: { status: 'confirmed' },
      },
      rows,
    });
    await world.run();
    expect(world.lines.map(({ level, fields }) => [level, fields])).toEqual([
      ['info', { enrollmentId: 'e1', messages: 3, files: 2 }],
      ['info', { enrollmentId: 'e2', messages: 1, files: 0 }],
    ]);
    for (const { fields } of world.lines) {
      expect(Object.keys(fields).sort()).toEqual(['enrollmentId', 'files', 'messages']);
    }
    const written = JSON.stringify(world.lines);
    for (const { id } of rows) {
      expect(written).not.toContain(`body of ${id}`);
      expect(written).not.toContain(`${id}.pdf`);
      expect(written).not.toContain(`/${id}`);
    }
  });

  it('a removal that fails writes one warn { messageId }, keeps the key, and is not counted', async () => {
    const world = worldOf({
      enrollments: { e1: {} },
      rows: [file('m1', 'e1'), file('m2', 'e1')],
      failing: ['chat/e1/m1'],
    });
    await world.run();
    expect(world.lines.map(({ level, fields }) => [level, fields])).toEqual([
      ['warn', { messageId: 'm1' }],
      ['info', { enrollmentId: 'e1', messages: 2, files: 1 }],
    ]);
    expect(
      world.rows.map(({ id, key, filename, purgedAt }) => [id, key, filename, purgedAt]),
    ).toEqual([
      ['m1', 'chat/e1/m1', null, DUE],
      ['m2', null, null, DUE],
    ]);
    expect(JSON.stringify(world.lines)).not.toContain('chat/e1/m1');
  });

  it('the next run removes the held-back file and writes { enrollmentId, messages: 0, files }, then nothing more', async () => {
    const world = worldOf({
      enrollments: { e1: {} },
      rows: [file('m1', 'e1'), file('m2', 'e1')],
      failing: ['chat/e1/m1'],
    });
    await world.run();
    world.storage.failing.clear();
    world.lines.length = 0;
    await world.run();
    expect(world.lines.map(({ level, fields }) => [level, fields])).toEqual([
      ['info', { enrollmentId: 'e1', messages: 0, files: 1 }],
    ]);
    expect(world.rows.every(({ key }) => key === null)).toBe(true);
    expect(world.storage.removed).toEqual(['chat/e1/m2', 'chat/e1/m1']);
    world.lines.length = 0;
    await world.run();
    expect(world.lines).toEqual([]);
    expect(world.storage.removed).toEqual(['chat/e1/m2', 'chat/e1/m1']);
  });

  it('a retry that fails again writes its warn and no info line', async () => {
    const world = worldOf({
      enrollments: { e1: {} },
      rows: [file('m1', 'e1')],
      failing: ['chat/e1/m1'],
    });
    await world.run();
    world.lines.length = 0;
    await world.run();
    expect(world.lines.map(({ level, fields }) => [level, fields])).toEqual([
      ['warn', { messageId: 'm1' }],
    ]);
  });
});

describe('purge-chat: a sweep (each failure on its own, every read paged)', () => {
  it('an enrollment whose purge fails is logged by its id and reported; the others go on', async () => {
    const world = worldOf({
      enrollments: { e1: {}, e2: {} },
      rows: [text('m1', 'e1'), text('m2', 'e2')],
      throwingOn: 'e1',
    });
    await world.run();
    expect(world.lines.map(({ level, fields }) => [level, fields])).toEqual([
      ['error', { enrollmentId: 'e1' }],
      ['info', { enrollmentId: 'e2', messages: 1, files: 0 }],
    ]);
    expect(world.reports).toHaveLength(1);
    expect(world.rows.find(({ id }) => id === 'm2')?.purgedAt).toEqual(DUE);
  });

  it('pages of one: every enrollment reached, and one retry line per enrollment across pages', async () => {
    const world = worldOf({
      enrollments: { e1: {}, e2: {}, e3: { status: 'confirmed' }, e4: {} },
      rows: [
        file('m1', 'e1'),
        file('m2', 'e1'),
        text('m3', 'e2'),
        text('m4', 'e3'),
        file('m5', 'e4'),
      ],
      failing: ['chat/e1/m1', 'chat/e1/m2'],
      pageSize: 1,
    });
    await world.run();
    expect(world.rows.filter(({ purgedAt }) => purgedAt !== null).map(({ id }) => id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm5',
    ]);
    world.storage.failing.clear();
    world.lines.length = 0;
    await world.run();
    expect(world.lines.map(({ level, fields }) => [level, fields])).toEqual([
      ['info', { enrollmentId: 'e1', messages: 0, files: 2 }],
    ]);
  });
});

describe('purge-chat: an open report keeps the chat (005:T012, FR-492, SRS FR-SESS-13; Q-R1 (a))', () => {
  const build = () =>
    worldOf({
      enrollments: { e1: {}, e2: {}, e3: { status: 'cancelled' }, e4: { open: true }, e5: {} },
      rows: [
        ...['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => text(`m-${id}`, id)),
        file('m-e1-file', 'e1'),
      ],
      userReports: [
        { enrollmentId: 'e1', status: 'open' },
        { enrollmentId: 'e2', status: 'actioned' },
        { enrollmentId: 'e3', status: 'dismissed' },
        { enrollmentId: null, status: 'open' },
      ],
    });
  const purgedOf = (world: World) => [
    ...new Set(world.rows.filter(({ purgedAt }) => purgedAt !== null).map((r) => r.enrollmentId)),
  ];

  it('an open report on the enrollment keeps its chat, as an open dispute does; an actioned or dismissed one holds nothing', async () => {
    const world = build();
    await world.run();
    expect(purgedOf(world)).toEqual(['e2', 'e3', 'e5']);
    expect(world.rows.find(({ id }) => id === 'm-e1')?.body).toBe('body of m-e1');
    expect(world.storage.removed).toEqual([]);
    expect(world.lines.map(({ fields }) => fields['enrollmentId'])).toEqual(['e2', 'e3', 'e5']);
  });

  it('a report raised after the page was read, before the lock was granted, is read under the lock: the chat is kept', async () => {
    const world = worldOf({
      enrollments: { e1: {} },
      rows: [text('m1', 'e1')],
      userReports: [],
      onLock: (id, { userReports }) => void userReports.push({ enrollmentId: id, status: 'open' }),
    });
    await world.run();
    expect(world.rows[0]?.purgedAt).toBeNull();
    expect(world.lines).toEqual([]);
  });

  it('twice = once with reports (R-API-14): the same rows purged, the reported chat kept both times', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: build,
      run: (world) => world.run(),
      observe: observed,
    });
    expect(twice).toEqual(once);
    const single = build();
    await single.run();
    await single.run();
    expect(single.rows.filter(({ purgedAt }) => purgedAt === null).map(({ id }) => id)).toEqual([
      'm-e1',
      'm-e4',
      'm-e1-file',
    ]);
  });
});
