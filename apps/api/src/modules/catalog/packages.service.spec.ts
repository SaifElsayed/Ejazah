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
import {
  MemoryPackages,
  OTHER_SUBJECT,
  OTHER_TEACHER,
  SUBJECT,
  TEACHER,
  TX,
} from './packages.fixtures.js';
import { PackagesService } from './packages.service.js';

const KEY = 'spec-packages-key-0001';
// The session's gender, the teacher's own.
const REQUESTER = 'female' as RequesterGender;

function serviceOver(memory: MemoryPackages) {
  const keyed: unknown[] = [];
  const service = new PackagesService({
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
