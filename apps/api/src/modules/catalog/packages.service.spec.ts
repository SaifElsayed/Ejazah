// T018 — the teacher's packages (app-surface.md "`teacher.packages` — catalog"; FR-311, FR-312,
// FR-314, FR-315, R-218, PR #109's review M3).
//
// A package is created only on a subject that is one of the teacher's `teacher_subjects`
// (`SUBJECT_NOT_APPROVED`), keyed so a retry answers the first outcome; it is deactivated and
// reactivated freely; once it has an enrollment its track and length stay as they are
// (`PACKAGE_FROZEN`, asked through T020's port) while its count, price and state still change, a
// new price reaching later purchases only since an enrollment keeps its snapshot; another
// teacher's package id answers NOT_FOUND and writes nothing. The list carries `published` as the
// visibility predicate answers it through identity's entry, asked with the session's gender (the
// owner's decision of 2026-11-02), and each package its price per session from `packages/money`,
// its confirmed enrollments and whether it is frozen. Every move locks the teacher's rows before
// it reads what it decides on (T005's rule 1). Over a store held in memory; the queries and the
// locks against Postgres are `tests/db-integrity/packages.spec.ts`'s.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  MemoryPackages,
  OTHER_SUBJECT,
  OTHER_TEACHER,
  SUBJECT,
  TEACHER,
  TX,
} from './packages.fixtures.js';
import {
  PackagesService,
  programmeAvailabilityOf,
  retirePreProgrammeIjazahPackages,
} from './packages.service.js';

const KEY = 'spec-packages-key-0001';
// The session's gender, the teacher's own.
const REQUESTER = 'female' as RequesterGender;

/**
 * 003:T113: the settings the average reads, `price_average_min_teachers` at the seed's 3 unless
 * told; 006:T004: the programme's switch off and the assessment's price unset, as seeded.
 */
function settingsWith(minTeachers: unknown = 3): SettingsReader {
  const seeded: Record<string, unknown> = {
    price_average_min_teachers: minTeachers,
    programme_enabled: 0,
    assessment_price_piasters: 0,
  };
  return {
    read: async (key, schema) => {
      if (!(key in seeded)) throw new Error(`no setting ${key} in this spec`);
      return schema.parse(seeded[key]);
    },
  };
}

function serviceOver(memory: MemoryPackages, settings: SettingsReader = settingsWith()) {
  const keyed: unknown[] = [];
  const service = new PackagesService({
    settings,
    transactions: { run: (work) => work(TX) },
    store: memory,
    use: memory,
    idempotency: {
      run: async (request, effect) => {
        keyed.push(request);
        return effect(TX);
      },
    },
  });
  return { service, keyed };
}

const RECITATION = {
  subject: SUBJECT,
  track: 'recitation',
  sessionCount: 3,
  sessionDurationMinutes: 45,
  price_piasters: piasters(100_000),
  isActive: true,
  // 006:T002 (rule d): `PackageRow` names whether it is a programme package.
  isProgramme: false,
} as const;

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown.code;
}

describe('list', () => {
  it('answers the caller’s packages only, each with its price per session, its confirmed enrollments and whether it is frozen', async () => {
    const memory = new MemoryPackages();
    const open = memory.plant(TEACHER, RECITATION);
    const sold = memory.plant(TEACHER, {
      ...RECITATION,
      subject: OTHER_SUBJECT,
      track: 'ijazah_track',
      sessionCount: 8,
      sessionDurationMinutes: 60,
      price_piasters: piasters(160_004),
      isActive: false,
    });
    memory.plant(OTHER_TEACHER, RECITATION);
    memory.enrol(sold, { total: 3, active: 2 });

    const answer = await serviceOver(memory).service.list(TEACHER, REQUESTER);

    expect(answer).toEqual({
      published: false,
      packages: [
        {
          id: open,
          subject: SUBJECT,
          track: 'recitation',
          sessionCount: 3,
          sessionDurationMinutes: 45,
          price_piasters: 100_000,
          // 100 000 over 3, rounded half up by `packages/money` (R-212).
          perSession_piasters: 33_333,
          isActive: true,
          activeEnrollmentCount: 0,
          frozen: false,
        },
        {
          id: sold,
          subject: OTHER_SUBJECT,
          track: 'ijazah_track',
          sessionCount: 8,
          sessionDurationMinutes: 60,
          price_piasters: 160_004,
          // 20 000.5 rounds up.
          perSession_piasters: 20_001,
          isActive: false,
          activeEnrollmentCount: 2,
          frozen: true,
        },
      ],
    });
  });

  it('answers `published` as the predicate answers it for the teacher, asked with the session’s gender (FR-315)', async () => {
    const memory = new MemoryPackages();
    memory.plant(TEACHER, RECITATION);
    const { service } = serviceOver(memory);
    await expect(service.list(TEACHER, REQUESTER)).resolves.toMatchObject({ published: false });
    memory.publish(TEACHER, 'male');
    await expect(service.list(TEACHER, REQUESTER)).resolves.toMatchObject({ published: false });
    memory.publish(TEACHER, 'female');
    await expect(service.list(TEACHER, REQUESTER)).resolves.toMatchObject({ published: true });
    expect(memory.log.filter((entry) => entry.startsWith('isPublished'))).toEqual([
      'isPublished:female',
      'isPublished:female',
      'isPublished:female',
    ]);
  });

  it('asks the port once for every package, not once per package', async () => {
    const memory = new MemoryPackages();
    memory.plant(TEACHER, RECITATION);
    memory.plant(TEACHER, RECITATION);
    memory.plant(TEACHER, RECITATION);
    await serviceOver(memory).service.list(TEACHER, REQUESTER);
    expect(memory.log.filter((entry) => entry.startsWith('package'))).toEqual([
      'packagesOf',
      'packageEnrollmentCounts',
    ]);
  });

  it('answers an empty list for a teacher with no package', async () => {
    const memory = new MemoryPackages();
    memory.plant(OTHER_TEACHER, RECITATION);
    memory.publish(TEACHER, 'female');
    await expect(serviceOver(memory).service.list(TEACHER, REQUESTER)).resolves.toEqual({
      published: true,
      packages: [],
    });
  });
});

const CREATE = {
  subjectId: SUBJECT.id,
  track: 'ijazah_track',
  sessionCount: 4,
  sessionDurationMinutes: 30,
  price_piasters: 90_000,
  isActive: true,
  idempotencyKey: KEY,
} as const;

describe('create', () => {
  it('writes the teacher’s package on one of the teacher’s subjects and answers it, neither frozen nor enrolled', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const answer = await serviceOver(memory).service.create(TEACHER, CREATE);

    const [written] = memory.all();
    expect(memory.all()).toHaveLength(1);
    expect(written).toMatchObject({
      teacherUserId: TEACHER,
      subject: SUBJECT,
      track: 'ijazah_track',
      sessionCount: 4,
      sessionDurationMinutes: 30,
      price_piasters: 90_000,
      isActive: true,
    });
    expect(answer).toEqual({
      id: written?.id,
      subject: SUBJECT,
      track: 'ijazah_track',
      sessionCount: 4,
      sessionDurationMinutes: 30,
      price_piasters: 90_000,
      perSession_piasters: 22_500,
      isActive: true,
      activeEnrollmentCount: 0,
      frozen: false,
    });
  });

  it('drafts an inactive package too', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    await serviceOver(memory).service.create(TEACHER, { ...CREATE, isActive: false });
    expect(memory.all()[0]?.isActive).toBe(false);
  });

  it('refuses a subject that is not one of the teacher’s SUBJECT_NOT_APPROVED and writes nothing (FR-311)', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, OTHER_SUBJECT);
    memory.grant(OTHER_TEACHER, SUBJECT);
    expect(await codeOf(serviceOver(memory).service.create(TEACHER, CREATE))).toBe(
      'SUBJECT_NOT_APPROVED',
    );
    expect(memory.all()).toEqual([]);
  });

  it('keys the write under `teacher.packages.create`, the caller’s, over the input without its key', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const { service, keyed } = serviceOver(memory);
    await service.create(TEACHER, CREATE);
    const { idempotencyKey: _key, ...input } = CREATE;
    expect(keyed).toEqual([
      { scope: 'teacher.packages.create', key: KEY, actorId: TEACHER, input },
    ]);
  });

  it('locks the teacher’s account, then the application, and only then reads the subject (T005)', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    await serviceOver(memory).service.create(TEACHER, CREATE);
    expect(memory.log).toEqual([
      // 006:T004 (Q-D1 (a)): an old-style ijazah-track package takes the switch's key first.
      'lockProgrammeSwitch',
      `lockAccount:${TEACHER}`,
      `lockApplication:${TEACHER}`,
      'holdsSubject',
      'insert',
    ]);
  });
});

describe('update', () => {
  it('answers another teacher’s package id NOT_FOUND and writes nothing (M3)', async () => {
    const memory = new MemoryPackages();
    const theirs = memory.plant(OTHER_TEACHER, RECITATION);
    const before = memory.held(theirs);
    const { service } = serviceOver(memory);
    for (const change of [
      { price_piasters: 1 },
      { isActive: false },
      { track: 'ijazah_track' as const, sessionDurationMinutes: 60 as const },
      {},
    ]) {
      expect(await codeOf(service.update(TEACHER, { packageId: theirs, ...change }))).toBe(
        'NOT_FOUND',
      );
    }
    expect(memory.held(theirs)).toEqual(before);
    expect(memory.log).not.toContain('change');
    expect(memory.log).not.toContain('packageHasEnrollment');
  });

  it('answers an id that names no package NOT_FOUND', async () => {
    const memory = new MemoryPackages();
    memory.plant(TEACHER, RECITATION);
    expect(
      await codeOf(
        serviceOver(memory).service.update(TEACHER, {
          packageId: '0199d0a0-0000-7000-8000-0000000000ff',
          isActive: false,
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('changes every field of a package with no enrollment and answers it', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    const answer = await serviceOver(memory).service.update(TEACHER, {
      packageId: id,
      track: 'ijazah_track',
      sessionCount: 10,
      sessionDurationMinutes: 60,
      price_piasters: 250_000,
      isActive: false,
    });
    expect(answer).toEqual({
      id,
      subject: SUBJECT,
      track: 'ijazah_track',
      sessionCount: 10,
      sessionDurationMinutes: 60,
      price_piasters: 250_000,
      perSession_piasters: 25_000,
      isActive: false,
      activeEnrollmentCount: 0,
      frozen: false,
    });
    expect(memory.held(id)).toMatchObject({ track: 'ijazah_track', sessionDurationMinutes: 60 });
  });

  it('deactivates and reactivates a package, enrolled or not (FR-314)', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    memory.enrol(id, { total: 1, active: 1 });
    const { service } = serviceOver(memory);
    await expect(
      service.update(TEACHER, { packageId: id, isActive: false }),
    ).resolves.toMatchObject({ isActive: false, frozen: true, activeEnrollmentCount: 1 });
    await expect(service.update(TEACHER, { packageId: id, isActive: true })).resolves.toMatchObject(
      {
        isActive: true,
      },
    );
  });

  it('refuses a new track or a new length once the package has an enrollment PACKAGE_FROZEN, and writes nothing (FR-312)', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    // A cancelled enrollment freezes it as well: the port counts every status.
    memory.enrol(id, { total: 1, active: 0 });
    const before = memory.held(id);
    const { service } = serviceOver(memory);
    for (const change of [
      { track: 'ijazah_track' as const },
      { sessionDurationMinutes: 60 as const },
      { track: 'ijazah_track' as const, price_piasters: 5 },
    ]) {
      expect(await codeOf(service.update(TEACHER, { packageId: id, ...change }))).toBe(
        'PACKAGE_FROZEN',
      );
    }
    expect(memory.held(id)).toEqual(before);
    expect(memory.log).not.toContain('change');
  });

  it('takes the same track and length on a frozen package as no change', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    memory.enrol(id, { total: 2, active: 2 });
    await expect(
      serviceOver(memory).service.update(TEACHER, {
        packageId: id,
        track: 'recitation',
        sessionDurationMinutes: 45,
        price_piasters: 120_000,
      }),
    ).resolves.toMatchObject({ track: 'recitation', price_piasters: 120_000 });
  });

  it('changes a frozen package’s price, count and state: the new price is the package’s, for later purchases (FR-312)', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    memory.enrol(id, { total: 1, active: 1 });
    const answer = await serviceOver(memory).service.update(TEACHER, {
      packageId: id,
      sessionCount: 5,
      price_piasters: 150_000,
      isActive: false,
    });
    expect(answer).toMatchObject({
      sessionCount: 5,
      price_piasters: 150_000,
      perSession_piasters: 30_000,
      isActive: false,
      frozen: true,
      activeEnrollmentCount: 1,
    });
    expect(memory.held(id)).toMatchObject({ track: 'recitation', sessionDurationMinutes: 45 });
  });

  it('locks the teacher’s account before it reads the package and asks whether it is enrolled (T005)', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    await serviceOver(memory).service.update(TEACHER, {
      packageId: id,
      sessionDurationMinutes: 60,
    });
    expect(memory.log.slice(0, 3)).toEqual([
      `lockAccount:${TEACHER}`,
      'packageOf',
      'packageHasEnrollment',
    ]);
    expect(memory.log).toContain('change');
  });
});

describe("averagePrice (003:T113; SRS DEC-88, FR-PROFILE-2 as amended): the editor's average-price hint", () => {
  const PEERS = [
    OTHER_TEACHER,
    '0199d0a0-0000-7000-8000-0000000000d3',
    '0199d0a0-0000-7000-8000-0000000000d4',
  ];
  const ASKED = { track: 'recitation', sessionDurationMinutes: 45 } as const;

  /** A published teacher's package on the asked track and length: the price over the count. */
  function peer(
    memory: MemoryPackages,
    teacherUserId: string,
    price: number,
    sessionCount: number,
  ) {
    memory.publish(teacherUserId, REQUESTER);
    memory.plant(teacherUserId, { ...RECITATION, price_piasters: piasters(price), sessionCount });
  }

  it('averages the price per session of three teachers, rounded half up to the piaster', async () => {
    const memory = new MemoryPackages();
    // Per session 33 333 (100 000 over 3), 30 000 and 45 002: 108 335 over 3 is 36 111.67.
    peer(memory, PEERS[0] ?? '', 100_000, 3);
    peer(memory, PEERS[1] ?? '', 90_000, 3);
    peer(memory, PEERS[2] ?? '', 45_002, 1);
    const { service } = serviceOver(memory);

    expect(await service.averagePrice(TEACHER, REQUESTER, ASKED)).toEqual({
      averagePerSession_piasters: 36_112,
    });
  });

  it('answers nothing when fewer than three teachers have one, however many packages they have', async () => {
    const memory = new MemoryPackages();
    peer(memory, PEERS[0] ?? '', 100_000, 3);
    peer(memory, PEERS[0] ?? '', 60_000, 2);
    peer(memory, PEERS[1] ?? '', 90_000, 3);
    peer(memory, PEERS[1] ?? '', 30_000, 1);
    const { service } = serviceOver(memory);

    expect(await service.averagePrice(TEACHER, REQUESTER, ASKED)).toEqual({});
  });

  it('reads the fewest teachers from price_average_min_teachers at each request: two are enough when it says 2', async () => {
    const memory = new MemoryPackages();
    // Per session 33 333 and 30 000: 63 333 over 2 is 31 666.5, rounded half up.
    peer(memory, PEERS[0] ?? '', 100_000, 3);
    peer(memory, PEERS[1] ?? '', 90_000, 3);

    expect(
      await serviceOver(memory, settingsWith(2)).service.averagePrice(TEACHER, REQUESTER, ASKED),
    ).toEqual({
      averagePerSession_piasters: 31_667,
    });
    expect(await serviceOver(memory).service.averagePrice(TEACHER, REQUESTER, ASKED)).toEqual({});
  });

  it("refuses a setting of 1, which would show one teacher's own price (the bound is 2, DEC-88)", async () => {
    const memory = new MemoryPackages();
    peer(memory, PEERS[0] ?? '', 100_000, 3);
    await expect(
      serviceOver(memory, settingsWith(1)).service.averagePrice(TEACHER, REQUESTER, ASKED),
    ).rejects.toThrow();
  });

  it('fails closed on a setting outside 2 to 100: the read is refused', async () => {
    const memory = new MemoryPackages();
    peer(memory, PEERS[0] ?? '', 100_000, 3);
    for (const bad of [0, 101, 2.5]) {
      await expect(
        serviceOver(memory, settingsWith(bad)).service.averagePrice(TEACHER, REQUESTER, ASKED),
        String(bad),
      ).rejects.toThrow();
    }
  });

  it("counts only teachers the predicate shows a student of the session's gender", async () => {
    const memory = new MemoryPackages();
    peer(memory, PEERS[0] ?? '', 100_000, 3);
    peer(memory, PEERS[1] ?? '', 90_000, 3);
    // The third is shown to the other gender only.
    memory.publish(PEERS[2] ?? '', 'male');
    memory.plant(PEERS[2] ?? '', {
      ...RECITATION,
      price_piasters: piasters(45_002),
      sessionCount: 1,
    });
    const { service } = serviceOver(memory);

    expect(await service.averagePrice(TEACHER, REQUESTER, ASKED)).toEqual({});
    expect(memory.log).toContain('visibleTeacherIds:female');
  });
});

// 006:T002 (SRS DEC-110, FR-PROFILE-3 as amended; spec.md FR-701's note; the note under T002,
// Q-3 (a)(a)): while `programme_enabled` is on, an old-style ijazah-track package (one made before
// the programme, `is_programme = false`) is not reactivated: CONFLICT with the detail code
// `programme_switch_on`, nothing written. The switch is read after the account's lock, the lock
// the switch's turn-on takes on that teacher too (`retirePreProgrammeIjazahPackages`). Deactivating
// it, any other edit of it, and reactivating a recitation or a programme package stay as today;
// with the switch off the teacher reactivates by hand (DEC-110).
describe('update while the programme’s switch is on (006:T002, DEC-110)', () => {
  const OLD_IJAZAH = {
    ...RECITATION,
    track: 'ijazah_track',
    sessionCount: 8,
    sessionDurationMinutes: 60,
    isActive: false,
  } as const;

  /** The switch at on (1) or off (0), each read logged in the store's log, in order. */
  function switchAt(memory: MemoryPackages, value: 0 | 1): SettingsReader {
    return {
      read: async (key, schema) => {
        if (key !== 'programme_enabled') throw new Error(`no setting ${key} in this spec`);
        memory.log.push('read:programme_enabled');
        return schema.parse(value);
      },
    };
  }

  async function refusalOf(call: Promise<unknown>): Promise<unknown> {
    return call.then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  it('refuses reactivating an old-style ijazah package CONFLICT programme_switch_on, and writes nothing', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, OLD_IJAZAH);
    const before = memory.held(id);
    const thrown = await refusalOf(
      serviceOver(memory, switchAt(memory, 1)).service.update(TEACHER, {
        packageId: id,
        isActive: true,
      }),
    );
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'isActive', code: 'programme_switch_on' }],
    });
    expect(memory.held(id)).toEqual(before);
    expect(memory.log).not.toContain('change');
  });

  it('refuses it with the price changed beside it too, writing neither', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, OLD_IJAZAH);
    const before = memory.held(id);
    const thrown = await refusalOf(
      serviceOver(memory, switchAt(memory, 1)).service.update(TEACHER, {
        packageId: id,
        isActive: true,
        price_piasters: 1_000,
      }),
    );
    expect(thrown).toMatchObject({ details: [{ code: 'programme_switch_on' }] });
    expect(memory.held(id)).toEqual(before);
  });

  it('reads the switch after the account’s lock and the package’s read', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, OLD_IJAZAH);
    await refusalOf(
      serviceOver(memory, switchAt(memory, 1)).service.update(TEACHER, {
        packageId: id,
        isActive: true,
      }),
    );
    expect(memory.log.slice(0, 3)).toEqual([
      `lockAccount:${TEACHER}`,
      'packageOf',
      'read:programme_enabled',
    ]);
  });

  it('reactivates it while the switch is off (DEC-110: by hand)', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, OLD_IJAZAH);
    await expect(
      serviceOver(memory, switchAt(memory, 0)).service.update(TEACHER, {
        packageId: id,
        isActive: true,
      }),
    ).resolves.toMatchObject({ isActive: true });
    expect(memory.held(id).isActive).toBe(true);
  });

  it('reactivates a recitation package while the switch is on, reading no switch', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, { ...RECITATION, isActive: false });
    await expect(
      serviceOver(memory, switchAt(memory, 1)).service.update(TEACHER, {
        packageId: id,
        isActive: true,
      }),
    ).resolves.toMatchObject({ isActive: true });
    expect(memory.log).not.toContain('read:programme_enabled');
  });

  it('reactivates a programme package while the switch is on', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, { ...PROGRAMME, isActive: false });
    // 006:T004 (Q-5 (a)): its activation reads the assessment's price too, set here.
    await expect(
      serviceOver(memory, programmeSettings({ enabled: 1, fee: 50_000 })).service.update(TEACHER, {
        packageId: id,
        isActive: true,
      }),
    ).resolves.toMatchObject({ isActive: true });
  });

  it('lets an old-style ijazah package be deactivated or re-priced while the switch is on', async () => {
    const memory = new MemoryPackages();
    const active = memory.plant(TEACHER, { ...OLD_IJAZAH, isActive: true });
    const inactive = memory.plant(TEACHER, OLD_IJAZAH);
    const { service } = serviceOver(memory, switchAt(memory, 1));
    await expect(
      service.update(TEACHER, { packageId: active, isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
    await expect(
      service.update(TEACHER, { packageId: inactive, price_piasters: 120_000 }),
    ).resolves.toMatchObject({ isActive: false, price_piasters: 120_000 });
    // An active one asked to stay active is no reactivation.
    const stays = memory.plant(TEACHER, { ...OLD_IJAZAH, isActive: true });
    await expect(
      service.update(TEACHER, { packageId: stays, isActive: true }),
    ).resolves.toMatchObject({ isActive: true });
  });
});

// 006:T002 (Q-3 (a)(a), DEC-110): the switch's turn-on deactivates every old-style ijazah package,
// on the change's transaction: the owners' accounts locked first, in one call, then the one update;
// the count answered for the audit entry and the log line. The query's filter is
// `tests/db-integrity/packages.spec.ts`'s.
describe('retirePreProgrammeIjazahPackages (006:T002, Q-3)', () => {
  it('locks the owners’ accounts, then deactivates, on the transaction it is handed, and answers the count', async () => {
    const memory = new MemoryPackages();
    memory.plant(OTHER_TEACHER, { ...RECITATION, track: 'ijazah_track' });
    memory.plant(TEACHER, { ...RECITATION, track: 'ijazah_track' });
    memory.plant(TEACHER, { ...RECITATION, track: 'ijazah_track', isActive: false });
    memory.plant(TEACHER, RECITATION);
    memory.plant(TEACHER, PROGRAMME);
    await expect(retirePreProgrammeIjazahPackages(memory, TX)).resolves.toBe(2);
    expect(memory.log).toEqual([
      'preProgrammeIjazahOwners',
      `lockAccounts:${[TEACHER, OTHER_TEACHER].sort().join(',')}`,
      'deactivatePreProgrammeIjazah',
    ]);
    expect(
      memory
        .all()
        .filter((row) => row.isActive)
        .map(({ track, isProgramme }) => [track, isProgramme]),
    ).toEqual([
      ['recitation', false],
      ['ijazah_track', true],
    ]);
  });

  it('answers 0 and locks nobody when no old-style ijazah package exists', async () => {
    const memory = new MemoryPackages();
    memory.plant(TEACHER, RECITATION);
    await expect(retirePreProgrammeIjazahPackages(memory, TX)).resolves.toBe(0);
    expect(memory.log).toEqual([
      'preProgrammeIjazahOwners',
      'lockAccounts:',
      'deactivatePreProgrammeIjazah',
    ]);
  });
});

// 006:T004 (R-503, FR-704; Q-5 (a)): a programme package, its three session prices and none of the
// old three, answered as the contract's programme member.
const PRICES = {
  m30_piasters: piasters(20_000),
  m45_piasters: piasters(28_000),
  m60_piasters: piasters(35_000),
} as const;
const PROGRAMME = {
  subject: SUBJECT,
  track: 'ijazah_track',
  isProgramme: true,
  prices: PRICES,
  isActive: true,
} as const;
const PLAIN_PRICES = { m30_piasters: 20_000, m45_piasters: 28_000, m60_piasters: 35_000 };

describe('programme packages (006:T004)', () => {
  it('lists a programme package with its three prices, enrolled and frozen as any other', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, PROGRAMME);
    memory.enrol(id, { total: 2, active: 1 });
    await expect(serviceOver(memory).service.list(TEACHER, REQUESTER)).resolves.toEqual({
      published: false,
      packages: [
        {
          id,
          subject: SUBJECT,
          track: 'ijazah_track',
          isProgramme: true,
          prices: PLAIN_PRICES,
          isActive: true,
          activeEnrollmentCount: 1,
          frozen: true,
        },
      ],
    });
  });

  it('creates a programme package with its three prices and no count, length or total', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const answer = await serviceOver(
      memory,
      programmeSettings({ enabled: 1, fee: 50_000 }),
    ).service.create(TEACHER, {
      subjectId: SUBJECT.id,
      track: 'ijazah_track',
      prices: PLAIN_PRICES,
      isActive: true,
      idempotencyKey: KEY,
    });
    const [written] = memory.all();
    expect(written).toStrictEqual({ ...PROGRAMME, id: written?.id, teacherUserId: TEACHER });
    expect(answer).toEqual({
      id: written?.id,
      subject: SUBJECT,
      track: 'ijazah_track',
      isProgramme: true,
      prices: PLAIN_PRICES,
      isActive: true,
      activeEnrollmentCount: 0,
      frozen: false,
    });
  });
});

/**
 * 006:T004: the programme's settings: the switch, the assessment's price (0 unset) and length,
 * each read logged as `read:<key>`; `price_average_min_teachers` at 3.
 */
function programmeSettings(
  values: { readonly enabled: 0 | 1; readonly fee: number; readonly length?: number },
  log: string[] = [],
): SettingsReader {
  const stored: Record<string, unknown> = {
    programme_enabled: values.enabled,
    assessment_price_piasters: values.fee,
    assessment_duration_minutes: values.length ?? 30,
    price_average_min_teachers: 3,
  };
  return {
    read: async (key, schema) => {
      if (!(key in stored)) throw new Error(`no setting ${key} in this spec`);
      log.push(`read:${key}`);
      return schema.parse(stored[key]);
    },
  };
}

describe('programmeAvailabilityOf (006:T004, Q-5 (a)): whether a programme package may be shown and booked', () => {
  it('is open while the switch is on and the fee above 0, with the fee and the assessment’s length', async () => {
    const log: string[] = [];
    await expect(
      programmeAvailabilityOf(programmeSettings({ enabled: 1, fee: 50_000, length: 45 }, log)),
    ).resolves.toStrictEqual({
      open: true,
      assessmentPrice_piasters: piasters(50_000),
      assessmentDurationMinutes: 45,
    });
    expect(log).toEqual([
      'read:programme_enabled',
      'read:assessment_price_piasters',
      'read:assessment_duration_minutes',
    ]);
  });

  it('is closed `programme_disabled` while the switch is off, the fee unread', async () => {
    const log: string[] = [];
    await expect(
      programmeAvailabilityOf(programmeSettings({ enabled: 0, fee: 50_000 }, log)),
    ).resolves.toStrictEqual({ open: false, refusal: 'programme_disabled' });
    expect(log).toEqual(['read:programme_enabled']);
  });

  it('is closed `assessment_fee_unset` while the fee is 0', async () => {
    await expect(
      programmeAvailabilityOf(programmeSettings({ enabled: 1, fee: 0 })),
    ).resolves.toStrictEqual({ open: false, refusal: 'assessment_fee_unset' });
  });
});

/** The refusal's code and details, or what else the call ended with. */
async function refusedWith(call: Promise<unknown>): Promise<unknown> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  return thrown instanceof DomainError ? { code: thrown.code, details: thrown.details } : thrown;
}

const conflict = (path: string, code: string) => ({ code: 'CONFLICT', details: [{ path, code }] });
const shape = (path: string) => ({
  code: 'VALIDATION_FAILED',
  details: [{ path, code: 'custom' }],
});

const PROGRAMME_CREATE = {
  subjectId: SUBJECT.id,
  track: 'ijazah_track',
  prices: PLAIN_PRICES,
  isActive: true,
  idempotencyKey: KEY,
} as const;

// 006:T004 (Q-B2 settled, SRS DEC-110; Q-5 (a)): while the switch is on, a new ijazah-track package
// is a programme package only; while it is off, none is made and ijazah-track packages are made as
// today. A programme package is created or activated only while the assessment's price is above 0;
// a draft is allowed.
describe('create under the programme’s switch (006:T004)', () => {
  it('refuses an active programme package while the assessment’s price is 0, assessment_fee_unset, writing nothing', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 0 }));
    expect(await refusedWith(service.create(TEACHER, PROGRAMME_CREATE))).toEqual(
      conflict('isActive', 'assessment_fee_unset'),
    );
    expect(memory.all()).toEqual([]);
  });

  it('drafts a programme package while the assessment’s price is 0', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 0 }));
    await expect(
      service.create(TEACHER, { ...PROGRAMME_CREATE, isActive: false }),
    ).resolves.toMatchObject({ isProgramme: true, isActive: false });
  });

  it('refuses a programme package while the switch is off, programme_disabled, writing nothing', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 0, fee: 50_000 }));
    for (const isActive of [true, false]) {
      expect(await refusedWith(service.create(TEACHER, { ...PROGRAMME_CREATE, isActive }))).toEqual(
        conflict('prices', 'programme_disabled'),
      );
    }
    expect(memory.all()).toEqual([]);
  });

  it('refuses an old-style ijazah-track package while the switch is on, programme_switch_on, writing nothing', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 50_000 }));
    expect(await refusedWith(service.create(TEACHER, CREATE))).toEqual(
      conflict('track', 'programme_switch_on'),
    );
    expect(memory.all()).toEqual([]);
  });

  it('makes an old-style ijazah-track package while the switch is off, as today', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 0, fee: 0 }));
    await expect(service.create(TEACHER, CREATE)).resolves.toMatchObject({
      track: 'ijazah_track',
      sessionCount: 4,
    });
  });

  it('reads the switch after the locks and the subject, and nothing for a recitation package', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const settings = programmeSettings({ enabled: 1, fee: 50_000 }, memory.log);
    await serviceOver(memory, settings).service.create(TEACHER, PROGRAMME_CREATE);
    expect(memory.log).toEqual([
      `lockAccount:${TEACHER}`,
      `lockApplication:${TEACHER}`,
      'holdsSubject',
      'read:programme_enabled',
      'read:assessment_price_piasters',
      'insert',
    ]);
    const log: string[] = [];
    const recitation = new MemoryPackages();
    recitation.grant(TEACHER, SUBJECT);
    await serviceOver(recitation, programmeSettings({ enabled: 1, fee: 0 }, log)).service.create(
      TEACHER,
      { ...CREATE, track: 'recitation' },
    );
    expect(log).toEqual([]);
  });

  // Q-D1 (a) (the owner, 2026-11-22): the switch's key before any row lock, so the turn-on, which
  // takes it before the switch's row and then the old packages' accounts, never crosses it.
  it('takes the switch’s key first, before the locks, for an old-style ijazah-track package', async () => {
    const memory = new MemoryPackages();
    memory.grant(TEACHER, SUBJECT);
    const settings = programmeSettings({ enabled: 0, fee: 0 }, memory.log);
    await serviceOver(memory, settings).service.create(TEACHER, CREATE);
    expect(memory.log).toEqual([
      'lockProgrammeSwitch',
      `lockAccount:${TEACHER}`,
      `lockApplication:${TEACHER}`,
      'holdsSubject',
      'read:programme_enabled',
      'insert',
    ]);
  });

  it('takes no switch key for a recitation package or a programme package', async () => {
    for (const input of [{ ...CREATE, track: 'recitation' as const }, PROGRAMME_CREATE]) {
      const memory = new MemoryPackages();
      memory.grant(TEACHER, SUBJECT);
      await serviceOver(memory, programmeSettings({ enabled: 1, fee: 50_000 })).service.create(
        TEACHER,
        input,
      );
      expect(memory.log).not.toContain('lockProgrammeSwitch');
    }
  });
});

describe('update of a programme package and to one (006:T004)', () => {
  const OPEN = { enabled: 1, fee: 50_000 } as const;
  const NEW_PRICES = { m30_piasters: 21_000, m45_piasters: 29_000, m60_piasters: 36_000 };

  it('changes a programme package’s three prices', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, PROGRAMME);
    await expect(
      serviceOver(memory, programmeSettings(OPEN)).service.update(TEACHER, {
        packageId: id,
        prices: NEW_PRICES,
      }),
    ).resolves.toMatchObject({ isProgramme: true, prices: NEW_PRICES });
  });

  it('refuses activating a programme package while the assessment’s price is 0, assessment_fee_unset, writing nothing', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, { ...PROGRAMME, isActive: false });
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 0 }));
    expect(await refusedWith(service.update(TEACHER, { packageId: id, isActive: true }))).toEqual(
      conflict('isActive', 'assessment_fee_unset'),
    );
    expect(memory.held(id).isActive).toBe(false);
    expect(memory.log).not.toContain('change');
  });

  it('re-prices or deactivates an active programme package while the price is 0: no activation', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, PROGRAMME);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 0 }));
    await expect(
      service.update(TEACHER, { packageId: id, prices: NEW_PRICES, isActive: true }),
    ).resolves.toMatchObject({ isActive: true, prices: NEW_PRICES });
    await expect(
      service.update(TEACHER, { packageId: id, isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
  });

  it('refuses a count, a length, a total or another track on a programme package, writing nothing', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, PROGRAMME);
    const { service } = serviceOver(memory, programmeSettings(OPEN));
    expect(await refusedWith(service.update(TEACHER, { packageId: id, sessionCount: 4 }))).toEqual(
      shape('sessionCount'),
    );
    expect(
      await refusedWith(service.update(TEACHER, { packageId: id, sessionDurationMinutes: 45 })),
    ).toEqual(shape('sessionDurationMinutes'));
    expect(
      await refusedWith(service.update(TEACHER, { packageId: id, price_piasters: 90_000 })),
    ).toEqual(shape('price_piasters'));
    expect(
      await refusedWith(service.update(TEACHER, { packageId: id, track: 'recitation' })),
    ).toEqual(shape('track'));
    expect(memory.log).not.toContain('change');
  });

  it('refuses three prices on a package with a count, its track unchanged, writing nothing', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, { ...RECITATION, track: 'ijazah_track' });
    const { service } = serviceOver(memory, programmeSettings(OPEN));
    expect(
      await refusedWith(service.update(TEACHER, { packageId: id, prices: NEW_PRICES })),
    ).toEqual(shape('prices'));
    expect(memory.log).not.toContain('change');
  });

  it('refuses turning a recitation package to ijazah-track without prices while the switch is on, programme_switch_on', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    const { service } = serviceOver(memory, programmeSettings(OPEN));
    expect(
      await refusedWith(service.update(TEACHER, { packageId: id, track: 'ijazah_track' })),
    ).toEqual(conflict('track', 'programme_switch_on'));
    expect(memory.held(id).track).toBe('recitation');
  });

  it('turns a recitation package to a programme package with its prices while the switch is on', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    const { service } = serviceOver(memory, programmeSettings(OPEN));
    await expect(
      service.update(TEACHER, { packageId: id, track: 'ijazah_track', prices: NEW_PRICES }),
    ).resolves.toEqual({
      id,
      subject: SUBJECT,
      track: 'ijazah_track',
      isProgramme: true,
      prices: NEW_PRICES,
      isActive: true,
      activeEnrollmentCount: 0,
      frozen: false,
    });
    expect(memory.held(id)).not.toHaveProperty('sessionCount');
  });

  it('refuses that turn while the switch is off, programme_disabled, writing nothing', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 0, fee: 50_000 }));
    expect(
      await refusedWith(
        service.update(TEACHER, { packageId: id, track: 'ijazah_track', prices: NEW_PRICES }),
      ),
    ).toEqual(conflict('prices', 'programme_disabled'));
    expect(memory.held(id).isProgramme).toBe(false);
  });

  it('refuses that turn to an active programme package while the price is 0; a draft turns', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 0 }));
    const turn = { packageId: id, track: 'ijazah_track', prices: NEW_PRICES } as const;
    expect(await refusedWith(service.update(TEACHER, turn))).toEqual(
      conflict('isActive', 'assessment_fee_unset'),
    );
    expect(memory.held(id).isProgramme).toBe(false);
    await expect(service.update(TEACHER, { ...turn, isActive: false })).resolves.toMatchObject({
      isProgramme: true,
      isActive: false,
    });
  });

  it('refuses that turn once the package has an enrollment, PACKAGE_FROZEN', async () => {
    const memory = new MemoryPackages();
    const id = memory.plant(TEACHER, RECITATION);
    memory.enrol(id, { total: 1, active: 1 });
    const { service } = serviceOver(memory, programmeSettings(OPEN));
    expect(
      await codeOf(
        service.update(TEACHER, { packageId: id, track: 'ijazah_track', prices: NEW_PRICES }),
      ),
    ).toBe('PACKAGE_FROZEN');
    expect(memory.held(id).isProgramme).toBe(false);
  });
});

// 006:T004 (SRS DEC-88 as amended, FR-704a): on the ijazah track the average is taken per length,
// a programme package counted by its price of that length, beside the other packages of that length.
describe('averagePrice over programme packages (006:T004)', () => {
  it('counts each programme package by its price of the asked length, beside the packages of that length', async () => {
    const memory = new MemoryPackages();
    const peers = [
      OTHER_TEACHER,
      '0199d0a0-0000-7000-8000-0000000000d3',
      '0199d0a0-0000-7000-8000-0000000000d4',
    ];
    for (const peer of peers) memory.publish(peer, REQUESTER);
    memory.plant(peers[0] ?? '', PROGRAMME);
    memory.plant(peers[1] ?? '', {
      ...PROGRAMME,
      prices: { ...PRICES, m45_piasters: piasters(30_001) },
    });
    // 90 000 over 3 at 45 minutes: 30 000 a session.
    memory.plant(peers[2] ?? '', {
      ...RECITATION,
      track: 'ijazah_track',
      sessionCount: 3,
      price_piasters: piasters(90_000),
    });
    const { service } = serviceOver(memory, programmeSettings({ enabled: 1, fee: 50_000 }));
    // 28 000, 30 001 and 30 000: 88 001 over 3 is 29 333.67.
    await expect(
      service.averagePrice(TEACHER, REQUESTER, {
        track: 'ijazah_track',
        sessionDurationMinutes: 45,
      }),
    ).resolves.toEqual({ averagePerSession_piasters: 29_334 });
  });
});
