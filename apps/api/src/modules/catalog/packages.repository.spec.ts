// 006:T004 (R-503, FR-704; data-model.md «packages»; ERD section 15 rules 73 and 74) — the
// `packages` queries over both shapes. A package with a count, a length and a total (recitation, or
// an ijazah-track one made while `programme_enabled` was off) reads as today with `isProgramme`
// false; a programme package reads its three session prices and none of the old three. A row whose
// columns break the shape the database checks is never answered as either. Queries only, over a
// recording stand-in of the client; the rows against Postgres are `tests/db-integrity`'s.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import {
  bookablePackageOf,
  changePackage,
  insertPackage,
  packagesOf,
  peerPackagesOf,
} from './packages.repository.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000004d1';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000004e1';
const SUBJECT = { id: '0199d0a0-0000-7000-8000-000000000461', nameAr: 'القرآن', nameEn: "Qur'an" };

/** A row as the client answers it: today's three set, the three prices NULL. */
const FIXED_COLUMNS = {
  id: PACKAGE,
  subject: SUBJECT,
  track: 'recitation',
  sessionCount: 4,
  sessionDurationMinutes: 45,
  pricePiasters: 100_000n,
  isActive: true,
  isProgramme: false,
  price30Piasters: null,
  price45Piasters: null,
  price60Piasters: null,
} as const;

/** A programme package's row: the three prices set, today's three NULL. */
const PROGRAMME_COLUMNS = {
  ...FIXED_COLUMNS,
  track: 'ijazah_track',
  sessionCount: null,
  sessionDurationMinutes: null,
  pricePiasters: null,
  isProgramme: true,
  price30Piasters: 20_000n,
  price45Piasters: 28_000n,
  price60Piasters: 35_000n,
} as const;

function clientOf(rows: readonly unknown[]) {
  const calls: [string, unknown][] = [];
  const answer =
    (name: string, value: () => unknown) =>
    async (query: unknown): Promise<unknown> => {
      calls.push([name, query]);
      return value();
    };
  const client = {
    package: {
      findMany: answer('findMany', () => rows),
      findFirst: answer('findFirst', () => rows[0] ?? null),
      create: answer('create', () => ({ id: PACKAGE })),
      updateMany: answer('updateMany', () => ({ count: 1 })),
    },
  } as unknown as Pick<Transaction, 'package'>;
  return { client, calls };
}

describe('the teacher’s packages read by shape (006:T004)', () => {
  it('reads a package with a count, a length and a total as today, `isProgramme` false', async () => {
    const { client } = clientOf([FIXED_COLUMNS]);
    await expect(packagesOf(client, TEACHER)).resolves.toStrictEqual([
      {
        id: PACKAGE,
        subject: SUBJECT,
        track: 'recitation',
        isActive: true,
        isProgramme: false,
        sessionCount: 4,
        sessionDurationMinutes: 45,
        price_piasters: piasters(100_000),
      },
    ]);
  });

  it('reads a programme package’s three session prices and none of the old three', async () => {
    const { client } = clientOf([PROGRAMME_COLUMNS]);
    await expect(packagesOf(client, TEACHER)).resolves.toStrictEqual([
      {
        id: PACKAGE,
        subject: SUBJECT,
        track: 'ijazah_track',
        isActive: true,
        isProgramme: true,
        prices: {
          m30_piasters: piasters(20_000),
          m45_piasters: piasters(28_000),
          m60_piasters: piasters(35_000),
        },
      },
    ]);
  });

  it('refuses a row whose columns break the shape check (rule 73): a programme package with a price missing', async () => {
    const { client } = clientOf([{ ...PROGRAMME_COLUMNS, price45Piasters: null }]);
    await expect(packagesOf(client, TEACHER)).rejects.toThrow(/shape/);
  });

  it('refuses a package with no programme mark and its count missing', async () => {
    const { client } = clientOf([{ ...FIXED_COLUMNS, sessionCount: null }]);
    await expect(packagesOf(client, TEACHER)).rejects.toThrow(/shape/);
  });
});

describe('the booking sheet’s package by its id (006:T004)', () => {
  it('answers a package with a count and a length as today, `isProgramme` false', async () => {
    const { client, calls } = clientOf([
      { id: PACKAGE, teacherUserId: TEACHER, ...pick(FIXED_COLUMNS) },
    ]);
    await expect(bookablePackageOf(client, PACKAGE)).resolves.toStrictEqual({
      id: PACKAGE,
      teacherUserId: TEACHER,
      isProgramme: false,
      sessionCount: 4,
      sessionDurationMinutes: 45,
    });
    expect(calls[0]?.[1]).toMatchObject({ where: { id: PACKAGE, isActive: true } });
  });

  it('answers a programme package with its three prices and no count or length', async () => {
    const { client } = clientOf([
      { id: PACKAGE, teacherUserId: TEACHER, ...pick(PROGRAMME_COLUMNS) },
    ]);
    await expect(bookablePackageOf(client, PACKAGE)).resolves.toStrictEqual({
      id: PACKAGE,
      teacherUserId: TEACHER,
      isProgramme: true,
      prices: {
        m30_piasters: piasters(20_000),
        m45_piasters: piasters(28_000),
        m60_piasters: piasters(35_000),
      },
    });
  });
});

describe('the writes by shape (006:T004)', () => {
  it('inserts a programme package with its three prices and the old three NULL', async () => {
    const { client, calls } = clientOf([PROGRAMME_COLUMNS]);
    await insertPackage(client, {
      teacherUserId: TEACHER,
      subjectId: SUBJECT.id,
      track: 'ijazah_track',
      isProgramme: true,
      prices: {
        m30_piasters: piasters(20_000),
        m45_piasters: piasters(28_000),
        m60_piasters: piasters(35_000),
      },
      isActive: false,
    });
    expect(calls[0]).toEqual([
      'create',
      {
        data: {
          teacherUserId: TEACHER,
          subjectId: SUBJECT.id,
          track: 'ijazah_track',
          isActive: false,
          isProgramme: true,
          sessionCount: null,
          sessionDurationMinutes: null,
          pricePiasters: null,
          price30Piasters: 20_000n,
          price45Piasters: 28_000n,
          price60Piasters: 35_000n,
        },
        select: { id: true },
      },
    ]);
  });

  it('inserts a package with a count, a length and a total as today, no price of the three', async () => {
    const { client, calls } = clientOf([FIXED_COLUMNS]);
    await insertPackage(client, {
      teacherUserId: TEACHER,
      subjectId: SUBJECT.id,
      track: 'recitation',
      isProgramme: false,
      sessionCount: 4,
      sessionDurationMinutes: 45,
      price_piasters: piasters(100_000),
      isActive: true,
    });
    expect(calls[0]).toEqual([
      'create',
      {
        data: {
          teacherUserId: TEACHER,
          subjectId: SUBJECT.id,
          track: 'recitation',
          isActive: true,
          isProgramme: false,
          sessionCount: 4,
          sessionDurationMinutes: 45,
          pricePiasters: 100_000n,
        },
        select: { id: true },
      },
    ]);
  });

  it('changes a programme package’s three prices', async () => {
    const { client, calls } = clientOf([]);
    await changePackage(client, TEACHER, PACKAGE, {
      prices: {
        m30_piasters: piasters(21_000),
        m45_piasters: piasters(29_000),
        m60_piasters: piasters(36_000),
      },
    });
    expect(calls[0]).toEqual([
      'updateMany',
      {
        where: { id: PACKAGE, teacherUserId: TEACHER },
        data: { price30Piasters: 21_000n, price45Piasters: 29_000n, price60Piasters: 36_000n },
      },
    ]);
  });

  it('turns a package into a programme package: the mark and the prices set, the old three NULL', async () => {
    const { client, calls } = clientOf([]);
    await changePackage(client, TEACHER, PACKAGE, {
      track: 'ijazah_track',
      isProgramme: true,
      prices: {
        m30_piasters: piasters(21_000),
        m45_piasters: piasters(29_000),
        m60_piasters: piasters(36_000),
      },
    });
    expect(calls[0]).toEqual([
      'updateMany',
      {
        where: { id: PACKAGE, teacherUserId: TEACHER },
        data: {
          track: 'ijazah_track',
          isProgramme: true,
          sessionCount: null,
          sessionDurationMinutes: null,
          pricePiasters: null,
          price30Piasters: 21_000n,
          price45Piasters: 29_000n,
          price60Piasters: 36_000n,
        },
      },
    ]);
  });
});

describe('the average’s pool by shape (006:T004, SRS DEC-88 as amended, FR-704a)', () => {
  it('reads the other teachers’ packages of the length, and the programme packages’ price of that length', async () => {
    const { client, calls } = clientOf([
      {
        ...NO_PRICES,
        teacherUserId: 'a',
        isProgramme: false,
        sessionCount: 4,
        pricePiasters: 100_000n,
      },
      { ...PRICES, teacherUserId: 'b', isProgramme: true, sessionCount: null, pricePiasters: null },
    ]);
    await expect(
      peerPackagesOf(client, {
        viewer: TEACHER,
        track: 'ijazah_track',
        sessionDurationMinutes: 45,
      }),
    ).resolves.toStrictEqual([
      {
        teacherUserId: 'a',
        isProgramme: false,
        price_piasters: piasters(100_000),
        sessionCount: 4,
      },
      { teacherUserId: 'b', isProgramme: true, sessionPrice_piasters: piasters(28_000) },
    ]);
    expect(calls[0]).toEqual([
      'findMany',
      {
        where: {
          isActive: true,
          track: 'ijazah_track',
          teacherUserId: { not: TEACHER },
          OR: [{ isProgramme: false, sessionDurationMinutes: 45 }, { isProgramme: true }],
        },
        select: {
          teacherUserId: true,
          isProgramme: true,
          sessionCount: true,
          pricePiasters: true,
          price30Piasters: true,
          price45Piasters: true,
          price60Piasters: true,
        },
      },
    ]);
  });
});

const NO_PRICES = { price30Piasters: null, price45Piasters: null, price60Piasters: null };
const PRICES = { price30Piasters: 20_000n, price45Piasters: 28_000n, price60Piasters: 35_000n };

/** The columns `bookablePackageOf` reads besides the id and the teacher. */
function pick(columns: typeof FIXED_COLUMNS | typeof PROGRAMME_COLUMNS) {
  const {
    isProgramme,
    sessionCount,
    sessionDurationMinutes,
    price30Piasters,
    price45Piasters,
    price60Piasters,
  } = columns;
  return {
    isProgramme,
    sessionCount,
    sessionDurationMinutes,
    price30Piasters,
    price45Piasters,
    price60Piasters,
  };
}
