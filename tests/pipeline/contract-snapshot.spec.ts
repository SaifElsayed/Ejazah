// T079 — the contract snapshot diff (FR-063, R-API-9, research R-12).
//
// R-API-9 forbids removing or renaming a tRPC procedure, a field or an enum value, because the
// clients in the field are always older than the server. The pipeline holds it by comparing the
// contract snapshot committed on the base branch with the one generated from the head: anything the
// base published and the head no longer does fails, naming R-API-9 and listing every such entry; an
// addition passes without comment (research R-12). A rename is the removal of the old name.
//
// The real routers carry no product procedure yet (contracts/README.md), so the cases below build
// fixture routers with the kernel's own caller kinds (`createAppRouter`, `createAdminRouter`,
// T107) on both surfaces, with nested input fields and an output parser, and enums of both sources
// the snapshot records: the Prisma enums of `prisma/schema/base.prisma` and any enum
// `packages/contracts` exports (owner's decisions 1 and 2, 2026-10-10). Zod is loaded from
// `apps/api`, which declares it; the repository root does not.
//
// The comparison against a base runs through git, as the pipeline runs it: the base snapshot is
// written into a throwaway repository and named by a git object, so `git show` reads it exactly as
// it reads `origin/develop`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import * as prettier from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';

import {
  adminProcedure,
  createAdminRouter,
  createAppRouter,
  publicProcedure,
  studentProcedure,
  teacherProcedure,
} from '../../apps/api/src/surfaces/procedures.js';
import {
  type ContractSnapshot,
  SNAPSHOT_PATH,
  type SnapshotSources,
  compareWithBase,
  findRemovals,
  loadSources,
  parseSnapshot,
  serializeSnapshot,
  snapshotOf,
} from '../../scripts/contract-snapshot';

const root = join(__dirname, '..', '..');

/** The schema type the caller kinds take: Zod's, as `apps/api` declares it. */
type Schema = Parameters<typeof publicProcedure>[0]['input'];

/** The part of Zod these fixtures use, loaded from the package that declares it. */
interface Zod {
  object(shape: Record<string, Schema>): Schema;
  string(): Schema;
  number(): Schema;
  boolean(): Schema;
  array(item: Schema): Schema;
  enum(values: readonly [string, ...string[]]): Schema;
  void(): Schema;
  null(): Schema;
}
const apiRequire = createRequire(join(root, 'apps', 'api', 'package.json'));
const { z } = apiRequire('zod') as { z: Zod };

/** tRPC's own builder, as `apps/api` declares it: the one way to declare a procedure outside the kinds. */
interface Trpc {
  create(): {
    procedure: { input(schema: Schema): { query(resolver: () => unknown): unknown } };
    router(record: object): { _def: { procedures: object } };
  };
}
const { initTRPC } = apiRequire('@trpc/server') as { initTRPC: Trpc };

/** A public procedure's rate limit (T170); the snapshot records neither the key nor the subject. */
const anyone = { key: 'rate_limit_search', subjectOf: () => 'anyone' } as const;

/** What a case changes in the fixture contract; every field left out keeps the base. */
interface Variant {
  readonly createName?: string;
  readonly slotDayField?: string;
  readonly outputStatuses?: readonly [string, ...string[]];
  readonly withEnrollmentId?: boolean;
  readonly withList?: boolean;
  readonly profileName?: string;
  readonly settingsOnApp?: boolean;
  readonly extraProcedure?: boolean;
  readonly extraField?: boolean;
  readonly extraRequiredField?: boolean;
  readonly extraOptionalObject?: boolean;
  readonly startTimeType?: 'number';
  readonly enrollmentIdType?: 'number';
  readonly enrollmentIdOptional?: boolean;
  readonly statusUnconstrained?: boolean;
  readonly commentRequired?: boolean;
  readonly notesOptional?: boolean;
  readonly outputNoteRequired?: boolean;
  readonly listKind?: 'mutation';
  readonly genders?: readonly string[];
  readonly withAccountStatus?: boolean;
  readonly sessionStatuses?: readonly [string, ...string[]];
}

/** A contract over both surfaces and both enum sources, changed as the variant says. */
function sources(variant: Variant = {}): SnapshotSources {
  const notes = z.array(z.string());
  const comment = z.string();
  const createInput: Record<string, Schema> = {
    packageId: z.string(),
    slot: z.object({
      [variant.slotDayField ?? 'dayOfWeek']: z.number(),
      startTimeLocal: variant.startTimeType === 'number' ? z.number() : z.string(),
    }),
    notes: variant.notesOptional === true ? notes.optional() : notes,
    comment: variant.commentRequired === true ? comment : comment.optional(),
  };
  if (variant.extraField === true) createInput['couponId'] = z.string().optional();
  if (variant.extraRequiredField === true) createInput['referralCode'] = z.string();
  if (variant.extraOptionalObject === true) {
    createInput['gift'] = z.object({ recipientName: z.string() }).optional();
  }
  const enrollmentId = variant.enrollmentIdType === 'number' ? z.number() : z.string();
  const note = z.string();
  const createOutput: Record<string, Schema> = {
    status:
      variant.statusUnconstrained === true
        ? z.string()
        : z.enum(variant.outputStatuses ?? ['pending_payment', 'confirmed']),
    note: variant.outputNoteRequired === true ? note : note.optional(),
  };
  if (variant.withEnrollmentId !== false) {
    createOutput['enrollmentId'] =
      variant.enrollmentIdOptional === true ? enrollmentId.optional() : enrollmentId;
  }

  const create = studentProcedure({
    input: z.object(createInput),
    output: z.object(createOutput),
  }).mutation(() => ({ status: 'pending_payment', enrollmentId: 'e' }));
  const listed = studentProcedure({ input: z.void(), output: z.array(z.string()) });
  const list = variant.listKind === 'mutation' ? listed.mutation(() => []) : listed.query(() => []);
  const booking = {
    [variant.createName ?? 'create']: create,
    ...(variant.withList === false ? {} : { list }),
  };
  const profile = {
    [variant.profileName ?? 'get']: publicProcedure({
      input: z.object({ teacherId: z.string() }),
      output: z.null(),
      rateLimit: anyone,
    }).query(() => null),
  };
  const availability = {
    set: teacherProcedure({
      admits: 'approved',
      input: z.object({ isActive: z.boolean() }),
      output: z.null(),
    }).mutation(() => null),
  };
  const reviews = {
    submit: studentProcedure({
      input: z.object({ rating: z.number() }),
      output: z.null(),
    }).mutation(() => null),
  };
  const settingsInput = z.object({ key: z.string(), value: z.number() });

  const app = createAppRouter({
    booking,
    profile,
    availability,
    ...(variant.extraProcedure === true ? { reviews } : {}),
    // The same path on the other surface: the administrator capability is not where it was.
    ...(variant.settingsOnApp === true
      ? {
          settings: {
            update: publicProcedure({
              input: settingsInput,
              output: z.null(),
              rateLimit: anyone,
            }).mutation(() => null),
          },
        }
      : {}),
  });
  const admin = createAdminRouter(
    variant.settingsOnApp === true
      ? {}
      : {
          settings: {
            update: adminProcedure({ input: settingsInput, output: z.null() }).mutation(() => null),
          },
        },
  );

  const genders = variant.genders ?? ['male', 'female'];
  const prismaEnums: Record<string, Record<string, string>> = {
    Gender: Object.fromEntries(genders.map((member) => [member, member])),
  };
  if (variant.withAccountStatus !== false) {
    prismaEnums['AccountStatus'] = { active: 'active', suspended: 'suspended', banned: 'banned' };
  }

  return {
    routers: { app, admin },
    prismaEnums,
    contracts: {
      SessionStatus: z.enum(variant.sessionStatuses ?? ['scheduled', 'done', 'disputed']),
      // Exports that are not enums are not recorded as enums.
      EnrollmentInput: z.object({ packageId: z.string() }),
      CONTRACT_VERSION: 1,
    },
  };
}

const base = (): ContractSnapshot => snapshotOf(sources());
const removalsAgainst = (variant: Variant): string[] =>
  findRemovals(base(), snapshotOf(sources(variant)));

describe('the snapshot records the published contract (T084, FR-063)', () => {
  it('records every procedure path with its surface and kind', () => {
    const snapshot = base();
    expect(Object.keys(snapshot.procedures.app)).toEqual([
      'availability.set',
      'booking.create',
      'booking.list',
      'profile.get',
    ]);
    expect(Object.keys(snapshot.procedures.admin)).toEqual(['settings.update']);
    expect(snapshot.procedures.app['booking.create']?.kind).toBe('mutation');
    expect(snapshot.procedures.app['profile.get']?.kind).toBe('query');
    expect(snapshot.procedures.admin['settings.update']?.kind).toBe('mutation');
  });

  it('records the fields of an input, nested, with their types and whether each is required', () => {
    const snapshot = base();
    expect(snapshot.procedures.app['booking.create']?.input).toEqual({
      $: { type: 'object' },
      '$.comment': { type: 'string' },
      '$.notes': { type: 'array', required: true },
      '$.notes[]': { type: 'string' },
      '$.packageId': { type: 'string', required: true },
      '$.slot': { type: 'object', required: true },
      '$.slot.dayOfWeek': { type: 'number', required: true },
      '$.slot.startTimeLocal': { type: 'string', required: true },
    });
  });

  it('records the fields of an output, and the values of an enum field', () => {
    const snapshot = base();
    expect(snapshot.procedures.app['booking.create']?.output).toEqual({
      $: { type: 'object' },
      '$.enrollmentId': { type: 'string', required: true },
      '$.note': { type: 'string' },
      '$.status': { type: 'string', values: ['confirmed', 'pending_payment'], required: true },
    });
    expect(snapshot.procedures.app['profile.get']?.output).toEqual({ $: { type: 'null' } });
  });

  // T169 (review finding SEC-3): an output inferred from the handler exists only for the compiler,
  // so a procedure without an output parser would be recorded as publishing nothing, and no removal
  // from its output could ever fail. The caller kinds cannot declare one; a router built around
  // them (which the surfaces refuse to mount, T098) is refused here, naming the procedure.
  it('refuses a procedure that has no output parser, naming its path (T169)', () => {
    const t = initTRPC.create();
    const stray = t.router({
      profile: t.router({
        get: t.procedure.input(z.object({ teacherId: z.string() })).query(() => null),
      }),
    });
    const { routers, ...rest } = sources();
    expect(() => snapshotOf({ ...rest, routers: { ...routers, app: stray } })).toThrow(
      /app profile\.get.*no output parser/,
    );
  });

  it('records every member of every enum, from the Prisma schema and from packages/contracts', () => {
    const snapshot = base();
    expect(snapshot.enums.prisma).toEqual({
      AccountStatus: ['active', 'banned', 'suspended'],
      Gender: ['female', 'male'],
    });
    expect(snapshot.enums.contracts).toEqual({ SessionStatus: ['disputed', 'done', 'scheduled'] });
  });
});

describe('a removal or rename fails (R-API-9)', () => {
  it('passes the same contract', () => {
    expect(findRemovals(base(), base())).toEqual([]);
  });

  it('fails a removed procedure', () => {
    const removals = removalsAgainst({ withList: false });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('app');
    expect(removals[0]).toContain('booking.list');
  });

  it('fails a renamed procedure as the removal of its old path', () => {
    const removals = removalsAgainst({ profileName: 'read' });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('profile.get');
  });

  it('fails a procedure moved to the other surface', () => {
    const removals = removalsAgainst({ settingsOnApp: true });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('admin');
    expect(removals[0]).toContain('settings.update');
  });

  it('fails a renamed input field, at any depth, as its removal and a new required field', () => {
    const removals = removalsAgainst({ slotDayField: 'weekday' });
    expect(removals).toHaveLength(2);
    expect(removals[0]).toContain('booking.create');
    expect(removals[0]).toContain('input');
    expect(removals[0]).toContain('$.slot.dayOfWeek');
    // The new name is required, and an old client does not send it.
    expect(removals[1]).toContain('$.slot.weekday');
    expect(removals[1]).toContain('absent → required');
  });

  it('fails a removed output field', () => {
    const removals = removalsAgainst({ withEnrollmentId: false });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('output');
    expect(removals[0]).toContain('$.enrollmentId');
  });

  it('fails a value removed from an enum field', () => {
    const removals = removalsAgainst({ outputStatuses: ['pending_payment'] });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('$.status');
    expect(removals[0]).toContain('confirmed');
  });

  it('fails a renamed member of a Prisma enum', () => {
    const removals = removalsAgainst({ genders: ['male', 'woman'] });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('Gender');
    expect(removals[0]).toContain('female');
  });

  it('fails a removed Prisma enum, listing each of its members', () => {
    const removals = removalsAgainst({ withAccountStatus: false });
    expect(removals).toHaveLength(3);
    for (const member of ['active', 'banned', 'suspended']) {
      expect(
        removals.some((line) => line.includes('AccountStatus') && line.includes(member)),
        member,
      ).toBe(true);
    }
  });

  it('fails a member removed from an enum packages/contracts exports', () => {
    const removals = removalsAgainst({ sessionStatuses: ['scheduled', 'done'] });
    expect(removals).toHaveLength(1);
    expect(removals[0]).toContain('SessionStatus');
    expect(removals[0]).toContain('disputed');
  });

  it('lists every removal at once', () => {
    const removals = removalsAgainst({
      withList: false,
      profileName: 'read',
      slotDayField: 'weekday',
      genders: ['male'],
    });
    // The renamed field counts twice: the old name removed, the new required name added.
    expect(removals).toHaveLength(5);
  });
});

// Owner's decision, 2026-10-10: an old client breaks on a changed type or kind exactly as it does
// on a removal, so each fails under R-API-9, listed with what it was and what it became.
describe('a changed type, kind or requirement fails like a removal (R-API-9)', () => {
  it('fails an input field whose type changes, showing before and after', () => {
    const changes = removalsAgainst({ startTimeType: 'number' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('input');
    expect(changes[0]).toContain('$.slot.startTimeLocal');
    expect(changes[0]).toContain('string → number');
  });

  it('fails an output field whose type changes', () => {
    const changes = removalsAgainst({ enrollmentIdType: 'number' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('output');
    expect(changes[0]).toContain('$.enrollmentId');
    expect(changes[0]).toContain('string → number');
  });

  it('fails an enum field that is no longer limited to its values', () => {
    const changes = removalsAgainst({ statusUnconstrained: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('$.status');
    expect(changes[0]).toContain('confirmed, pending_payment → any');
  });

  it('fails a procedure whose kind changes, showing before and after', () => {
    const changes = removalsAgainst({ listKind: 'mutation' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('booking.list');
    expect(changes[0]).toContain('query → mutation');
  });

  it('fails an optional input field that becomes required', () => {
    const changes = removalsAgainst({ commentRequired: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('$.comment');
    expect(changes[0]).toContain('optional → required');
  });

  it('fails a new required input field on a published procedure', () => {
    const changes = removalsAgainst({ extraRequiredField: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('$.referralCode');
    expect(changes[0]).toContain('absent → required');
  });

  it('fails a required output field that becomes optional', () => {
    const changes = removalsAgainst({ enrollmentIdOptional: true });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toContain('output');
    expect(changes[0]).toContain('$.enrollmentId');
    expect(changes[0]).toContain('required → optional');
  });

  it('passes a required input field that becomes optional, and an optional output that becomes required', () => {
    expect(removalsAgainst({ notesOptional: true, outputNoteRequired: true })).toEqual([]);
  });
});

describe('an addition passes without comment', () => {
  it('passes a new procedure, a new optional field, a new enum value and a new enum member', () => {
    expect(
      removalsAgainst({
        extraProcedure: true,
        extraField: true,
        outputStatuses: ['pending_payment', 'confirmed', 'cancelled'],
        genders: ['male', 'female', 'other'],
        sessionStatuses: ['scheduled', 'done', 'disputed', 'cancelled_by_admin'],
      }),
    ).toEqual([]);
  });

  it('passes a new optional object whose own fields are required', () => {
    expect(removalsAgainst({ extraOptionalObject: true })).toEqual([]);
  });

  it('passes a new enum', () => {
    expect(findRemovals(snapshotOf(sources({ withAccountStatus: false })), base())).toEqual([]);
  });
});

describe('the comparison reads the base’s committed snapshot through git (owner’s decision 4)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }

  /** A throwaway repository whose tree holds `snapshot` at the committed path, or nothing there. */
  async function baseHolding(
    snapshot: ContractSnapshot | undefined,
  ): Promise<{ cwd: string; ref: string }> {
    const cwd = mkdtempSync(join(tmpdir(), 'ijazah-snapshot-'));
    directories.push(cwd);
    git(cwd, 'init', '--quiet');
    writeFileSync(join(cwd, 'README'), 'base\n');
    git(cwd, 'add', 'README');
    if (snapshot !== undefined) {
      const file = join(cwd, SNAPSHOT_PATH);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, await serializeSnapshot(snapshot));
      git(cwd, 'add', SNAPSHOT_PATH);
    }
    // A tree names the base exactly as a branch does for `git show <ref>:<path>`.
    return { cwd, ref: git(cwd, 'write-tree') };
  }

  it('fails a removal, naming R-API-9 and listing every removed entry', async () => {
    const { cwd, ref } = await baseHolding(base());
    const head = snapshotOf(sources({ withList: false, genders: ['male'] }));
    const result = compareWithBase({ head, ref, cwd });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('R-API-9');
    expect(result.message).toContain('booking.list');
    expect(result.message).toContain('female');
  });

  it('fails a changed type and kind, naming R-API-9 with before and after', async () => {
    const { cwd, ref } = await baseHolding(base());
    const head = snapshotOf(sources({ startTimeType: 'number', listKind: 'mutation' }));
    const result = compareWithBase({ head, ref, cwd });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('R-API-9');
    expect(result.message).toContain('string → number');
    expect(result.message).toContain('query → mutation');
  });

  it('passes an addition with no message', async () => {
    const { cwd, ref } = await baseHolding(base());
    const head = snapshotOf(sources({ extraProcedure: true, extraField: true }));
    expect(compareWithBase({ head, ref, cwd })).toEqual({ ok: true, message: '' });
  });

  it('passes, and says so, when the base holds no snapshot yet', async () => {
    const { cwd, ref } = await baseHolding(undefined);
    const result = compareWithBase({ head: base(), ref, cwd });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('no contract snapshot');
  });

  it('refuses a base git does not know', async () => {
    const { cwd } = await baseHolding(undefined);
    expect(() => compareWithBase({ head: base(), ref: 'no-such-branch', cwd })).toThrow(
      /no-such-branch/,
    );
  });
});

describe('the committed file is deterministic (owner’s decision 3)', () => {
  it('serializes the same contract to the same text, whatever order it was built in', async () => {
    const built = base();
    const reordered: ContractSnapshot = {
      enums: {
        contracts: built.enums.contracts,
        prisma: Object.fromEntries(Object.entries(built.enums.prisma).reverse()),
      },
      procedures: {
        admin: built.procedures.admin,
        app: Object.fromEntries(Object.entries(built.procedures.app).reverse()),
      },
    };
    expect(await serializeSnapshot(reordered)).toBe(await serializeSnapshot(built));
  });

  it('is left unchanged by Prettier, and reads back as the same contract', async () => {
    const text = await serializeSnapshot(base());
    const filepath = join(root, SNAPSHOT_PATH);
    const options = await prettier.resolveConfig(filepath);
    expect(await prettier.check(text, { ...options, filepath })).toBe(true);
    expect(parseSnapshot(text)).toEqual(base());
  });
});

describe('the real contract (T084)', () => {
  it('records every enum of prisma/schema/base.prisma with every member', async () => {
    const snapshot = snapshotOf(await loadSources());
    const schema = readFileSync(join(root, 'prisma', 'schema', 'base.prisma'), 'utf8');
    const declared: Record<string, string[]> = {};
    for (const [, name, body] of schema.matchAll(/^enum (\w+) \{([^}]*)\}/gm)) {
      declared[name ?? ''] = (body ?? '')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .filter((line) => line !== '' && !line.startsWith('@@'))
        .map((line) => line.split(/\s/)[0] ?? '')
        .sort();
    }
    // 28 enums of Phase 0 and the eight the Phase 1 ERD pass declared (T009 to T012).
    expect(Object.keys(declared)).toHaveLength(36);
    expect(snapshot.enums.prisma).toEqual(declared);
    expect(Object.keys(snapshot.procedures)).toEqual(['admin', 'app']);
  });
});
