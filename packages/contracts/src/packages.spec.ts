// T016 — the `teacher.packages` schemas of specs/003-booking/contracts/app-surface.md (FR-311 to
// FR-315). Written before the schemas, and run red first.
//
// What the database refuses (ERD §15 rule 36: `session_count >= 1`, `price_piasters > 0`,
// `session_duration_minutes IN (30, 45, 60)`) is refused here first, so a client gets a validation
// error and never a constraint violation: 29 or 31 minutes, a price of zero, a fraction of a
// piaster, no session. `published` rides on the list and `frozen` on each package (FR-312, FR-315).
import { describe, expect, it } from 'vitest';

import {
  packagesCreateInput,
  packagesListOutput,
  packagesUpdateInput,
  packageTrack,
  SESSION_LENGTHS_MINUTES,
  sessionLengthMinutes,
  teacherPackage,
} from './packages.js';

const ids = {
  subject: '0199d0a0-0000-7000-8000-000000000051',
  package: '0199d0a0-0000-7000-8000-0000000000a1',
};

const create = {
  subjectId: ids.subject,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
  isActive: true,
  idempotencyKey: 'package-0199d0a0-0000-7000',
} as const;

const item = {
  id: ids.package,
  subject: { id: ids.subject, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
  track: 'ijazah_track',
  sessionCount: 8,
  sessionDurationMinutes: 60,
  price_piasters: 120_000,
  perSession_piasters: 15_000,
  isActive: true,
  activeEnrollmentCount: 0,
  frozen: false,
} as const;

describe('the session length (30, 45 or 60 minutes, FR-PROFILE-2 as amended)', () => {
  it('is the three lengths and nothing else', () => {
    expect(SESSION_LENGTHS_MINUTES).toEqual([30, 45, 60]);
    for (const length of [30, 45, 60]) {
      expect(sessionLengthMinutes.safeParse(length).success).toBe(true);
      expect(
        packagesCreateInput.safeParse({ ...create, sessionDurationMinutes: length }).success,
      ).toBe(true);
    }
  });

  it('refuses 29 and 31 minutes, 90, zero, a fraction and a string', () => {
    for (const length of [29, 31, 90, 0, 44.5, '45']) {
      expect(
        packagesCreateInput.safeParse({ ...create, sessionDurationMinutes: length }).success,
      ).toBe(false);
      expect(
        packagesUpdateInput.safeParse({ packageId: ids.package, sessionDurationMinutes: length })
          .success,
      ).toBe(false);
    }
  });
});

describe('the price (whole piasters, more than zero, FR-311)', () => {
  it('takes one piaster and a large whole price', () => {
    for (const price_piasters of [1, 9_999_999]) {
      expect(packagesCreateInput.safeParse({ ...create, price_piasters }).success).toBe(true);
    }
  });

  it('refuses zero, a negative price, a fraction of a piaster and pounds as text', () => {
    for (const price_piasters of [0, -100, 1200.5, '1200', Number.MAX_SAFE_INTEGER + 1]) {
      expect(packagesCreateInput.safeParse({ ...create, price_piasters }).success).toBe(false);
      expect(
        packagesUpdateInput.safeParse({ packageId: ids.package, price_piasters }).success,
      ).toBe(false);
    }
  });
});

describe('the session count (at least one)', () => {
  it('takes one and refuses zero, a negative count and a fraction', () => {
    expect(packagesCreateInput.safeParse({ ...create, sessionCount: 1 }).success).toBe(true);
    for (const sessionCount of [0, -1, 2.5]) {
      expect(packagesCreateInput.safeParse({ ...create, sessionCount }).success).toBe(false);
    }
  });
});

describe('the track (ADR 0018 D1)', () => {
  it('is recitation or the ijazah track, as `package_track` holds them', () => {
    expect(packageTrack.options).toEqual(['recitation', 'ijazah_track']);
    expect(packagesCreateInput.safeParse({ ...create, track: 'tajweed' }).success).toBe(false);
  });
});

describe('create and update', () => {
  it('create needs every field and the idempotency key', () => {
    expect(packagesCreateInput.safeParse(create).success).toBe(true);
    for (const field of Object.keys(create)) {
      const { [field as keyof typeof create]: _dropped, ...partial } = create;
      expect(packagesCreateInput.safeParse(partial).success).toBe(false);
    }
  });

  it('update names the package and changes only what it carries; no subject', () => {
    expect(packagesUpdateInput.safeParse({ packageId: ids.package }).success).toBe(true);
    expect(packagesUpdateInput.safeParse({ packageId: ids.package, isActive: false }).success).toBe(
      true,
    );
    expect(packagesUpdateInput.safeParse({ isActive: false }).success).toBe(false);
    expect(packagesUpdateInput.safeParse({ packageId: 'not-a-uuid' }).success).toBe(false);
    expect(packagesUpdateInput.shape).not.toHaveProperty('subjectId');
    expect(packagesUpdateInput.shape).not.toHaveProperty('idempotencyKey');
  });

  it('name no teacher, user or gender: the caller is the teacher (R-GENDER-4)', () => {
    for (const schema of [packagesCreateInput, packagesUpdateInput]) {
      for (const key of Object.keys(schema.shape)) {
        expect(key).not.toMatch(/^(teacher|user)(Id|UserId)?$|gender|role/i);
      }
    }
  });
});

describe('the outputs', () => {
  it('a package carries `frozen`, its active enrollments and the price per session', () => {
    expect(teacherPackage.parse(item)).toEqual(item);
    expect(teacherPackage.safeParse({ ...item, frozen: undefined }).success).toBe(false);
    expect(teacherPackage.safeParse({ ...item, price_piasters: 0 }).success).toBe(false);
    expect(teacherPackage.safeParse({ ...item, sessionDurationMinutes: 31 }).success).toBe(false);
  });

  it('the list carries `published` beside the packages (FR-315)', () => {
    const list = { published: false, packages: [item] };
    expect(packagesListOutput.parse(list)).toEqual(list);
    expect(packagesListOutput.safeParse({ packages: [item] }).success).toBe(false);
  });

  it('strip a field the schema does not name (R-HONEST-4)', () => {
    const parsed = teacherPackage.parse({ ...item, teacherUserId: ids.subject, currency: 'EGP' });
    expect(parsed).not.toHaveProperty('teacherUserId');
    expect(parsed).not.toHaveProperty('currency');
  });
});
