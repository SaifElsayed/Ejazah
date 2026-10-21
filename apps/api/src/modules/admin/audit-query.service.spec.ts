// T065 (FR-176, FR-180, FR-181): the audit log as the admin pages read it. Each row carries the
// label stored at write time and, beside it, the target's name read now: a renamed person reads
// under the new name while the label stays, a deleted one under the role word. Reads are audited
// like writes but neither list shows an action ending in `.read`, and nothing else is left out
// (owner's decision 2026-10-21). The search matches the stored label and the reason, as the
// page's field says («الهدف أو السبب»), in any case, with `%` and `_` meaning themselves.
//
// Over the real database. Every case writes its entries inside a transaction it rolls back, each
// naming a target of its own, so specs running together never see each other's rows; the person's
// name comes from a stand-in reader, as `target-label.spec.ts` reads it (the person is the
// identity module's row).
import { randomUUID } from 'node:crypto';

import { addHours, addMinutes } from '@ijazah/time';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, type Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type AdminWorld,
  buildAdmin,
  openSpecDatabase,
  rolledBack,
  SEEDED_ADMIN_SETTINGS,
  settingsOf,
} from './__fixtures__/admin.js';
import { AuditQueryService } from './audit-query.service.js';
import type { TargetPerson } from '../identity/index.js';
import { readAdministratorName } from './admin-users.repository.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
let actorId: string;
beforeEach(async () => {
  world = buildAdmin(database);
  ({ adminId: actorId } = await world.createAdministrator({ displayName: 'هالة سعيد' }));
});

/** The people the stand-in reader knows, by id; a spec renames or deletes one between reads. */
let people: Map<string, TargetPerson>;
beforeEach(() => {
  people = new Map();
});

function query(overrides: Partial<{ readonly pageSize: number }> = {}): AuditQueryService {
  return new AuditQueryService({
    settings: settingsOf({
      ...SEEDED_ADMIN_SETTINGS,
      ...(overrides.pageSize === undefined ? {} : { admin_list_page_size: overrides.pageSize }),
    }),
    names: {
      person: async (_tx, userId) => people.get(userId) ?? null,
      administrator: readAdministratorName,
    },
  });
}

/** An instant in 2099, where no other spec writes, `minute` minutes into its first day. */
const YEAR_2099 = new Date('2099-01-01T00:00:00Z');
const at = (minute: number) => new Date(addMinutes(YEAR_2099, minute));

function entry(
  tx: Transaction,
  fields: {
    readonly action: string;
    readonly targetType?: string;
    readonly targetId: string;
    readonly minute: number;
    readonly reason?: string;
  },
) {
  return world.rows.auditEntry(tx, {
    adminId: actorId,
    action: fields.action,
    targetType: fields.targetType ?? 'user',
    targetId: fields.targetId,
    occurredAt: at(fields.minute),
    ...(fields.reason === undefined ? {} : { reason: fields.reason }),
  });
}

describe('audit.list', () => {
  it('lists a target’s entries newest first, with the stored label, the name read now, the acting administrator and the reason', async () => {
    const userId = randomUUID();
    people.set(userId, { displayName: 'سارة أحمد', role: 'teacher', deleted: false });
    const answer = await rolledBack(database, async (tx) => {
      await entry(tx, {
        action: 'user.require_identity',
        targetId: userId,
        minute: 1,
        reason: 'وثيقة غير واضحة',
      });
      await entry(tx, {
        action: 'application.approve',
        targetType: 'teacher_application',
        targetId: userId,
        minute: 2,
      });
      return query().list(tx, { targetId: userId, page: 1 });
    });
    expect(answer.total).toBe(2);
    expect(answer.rows).toEqual([
      {
        entryId: expect.any(String),
        occurredAt: '2099-01-01T00:02:00.000Z',
        adminName: 'هالة سعيد',
        action: 'application.approve',
        targetLabel: `طلب انضمام · ${userId}`,
        targetName: 'سارة أحمد',
        targetType: 'teacher_application',
        targetId: userId,
      },
      {
        entryId: expect.any(String),
        occurredAt: '2099-01-01T00:01:00.000Z',
        adminName: 'هالة سعيد',
        action: 'user.require_identity',
        targetLabel: `حساب · ${userId}`,
        targetName: 'سارة أحمد',
        targetType: 'user',
        targetId: userId,
        reason: 'وثيقة غير واضحة',
      },
    ]);
  });

  it('a renamed person reads under the new name, and the label stays what was written', async () => {
    const userId = randomUUID();
    people.set(userId, { displayName: 'سارة أحمد', role: 'teacher', deleted: false });
    const [before, after] = await rolledBack(database, async (tx) => {
      await entry(tx, { action: 'application.approve', targetId: userId, minute: 1 });
      const first = await query().list(tx, { targetId: userId, page: 1 });
      people.set(userId, { displayName: 'سارة محمود', role: 'teacher', deleted: false });
      return [first, await query().list(tx, { targetId: userId, page: 1 })] as const;
    });
    expect(before.rows[0]).toMatchObject({
      targetName: 'سارة أحمد',
      targetLabel: `حساب · ${userId}`,
    });
    expect(after.rows[0]).toMatchObject({
      targetName: 'سارة محمود',
      targetLabel: `حساب · ${userId}`,
    });
  });

  it('a deleted person reads under the role word, never under a name that no longer exists', async () => {
    const userId = randomUUID();
    people.set(userId, { displayName: null, role: 'teacher', deleted: true });
    const answer = await rolledBack(database, async (tx) => {
      await entry(tx, { action: 'teacher.ban', targetId: userId, minute: 1 });
      return query().list(tx, { targetId: userId, page: 1 });
    });
    expect(answer.rows[0]).toMatchObject({ targetName: 'معلم', targetLabel: `حساب · ${userId}` });
  });

  it('names an administrator target by the administrator’s row, and a credential by nothing', async () => {
    const credentialId = randomUUID();
    const answer = await rolledBack(database, async (tx) => {
      await entry(tx, {
        action: 'admin.reset_mfa',
        targetType: 'admin',
        targetId: actorId,
        minute: 1,
      });
      await entry(tx, {
        action: 'credential.approve',
        targetType: 'credential',
        targetId: credentialId,
        minute: 2,
      });
      return [
        await query().list(tx, { targetId: actorId, targetType: 'admin', page: 1 }),
        await query().list(tx, { targetId: credentialId, page: 1 }),
      ] as const;
    });
    expect(answer[0].rows[0]).toMatchObject({ targetName: 'هالة سعيد', targetType: 'admin' });
    expect(answer[1].rows[0]).not.toHaveProperty('targetName');
  });

  it('leaves out the actions ending in .read and nothing else: a document viewed is listed', async () => {
    const userId = randomUUID();
    const answer = await rolledBack(database, async (tx) => {
      await entry(tx, { action: 'applications.read', targetId: userId, minute: 1 });
      await entry(tx, {
        action: 'document.view',
        targetType: 'document',
        targetId: userId,
        minute: 2,
      });
      await entry(tx, { action: 'audit.read', targetId: userId, minute: 3 });
      await entry(tx, { action: 'admin.sign_out', targetId: userId, minute: 4 });
      return query().list(tx, { targetId: userId, page: 1 });
    });
    expect(answer.rows.map((row) => row.action)).toEqual(['admin.sign_out', 'document.view']);
    expect(answer.total).toBe(2);
  });

  it('searches the stored label and the reason in any case, and neither the action nor the administrator’s name', async () => {
    const token = randomUUID();
    const userId = randomUUID();
    const [byLabel, byReason, byAction, byAdmin] = await rolledBack(database, async (tx) => {
      await entry(tx, { action: 'application.reject', targetId: userId, minute: 1 });
      await entry(tx, {
        action: 'teacher.suspend',
        targetId: randomUUID(),
        minute: 2,
        reason: `Unclear SCAN ${token}`,
      });
      return [
        await query().list(tx, { search: userId.toUpperCase(), page: 1 }),
        await query().list(tx, { search: `unclear scan ${token.toUpperCase()}`, page: 1 }),
        await query().list(tx, { search: 'application.reject', targetId: userId, page: 1 }),
        await query().list(tx, { search: 'هالة', targetId: userId, page: 1 }),
      ] as const;
    });
    expect(byLabel.rows.map((row) => row.targetId)).toEqual([userId]);
    expect(byReason.rows.map((row) => row.action)).toEqual(['teacher.suspend']);
    expect(byAction.total).toBe(0);
    expect(byAdmin.total).toBe(0);
  });

  it('answers a zone the time package refuses with VALIDATION_FAILED naming timeZone, never the internal error', async () => {
    for (const timeZone of ['UTC', 'Etc/UTC', 'Mars/Olympus']) {
      const error = await rolledBack(database, (tx) =>
        query()
          .list(tx, { from: '2026-10-01', timeZone, page: 1 })
          .then(
            () => null,
            (thrown: unknown) => thrown,
          ),
      );
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'timeZone', code: 'unknown' }],
      });
    }
  });

  it('takes % and _ in a search as the characters themselves, never as a pattern', async () => {
    const token = randomUUID().slice(0, 8);
    const [percent, underscore, literal] = await rolledBack(database, async (tx) => {
      await entry(tx, {
        action: 'teacher.suspend',
        targetId: randomUUID(),
        minute: 1,
        reason: `${token} 50% done_now`,
      });
      await entry(tx, {
        action: 'teacher.suspend',
        targetId: randomUUID(),
        minute: 2,
        reason: `${token} 50x doneXnow`,
      });
      return [
        await query().list(tx, { search: `${token} 50%`, page: 1 }),
        await query().list(tx, { search: 'done_now', page: 1 }),
        await query().list(tx, { search: `${token} 50x`, page: 1 }),
      ] as const;
    });
    expect(percent.rows.map((row) => row.reason)).toEqual([`${token} 50% done_now`]);
    expect(underscore.rows.map((row) => row.reason)).toEqual([`${token} 50% done_now`]);
    expect(literal.rows.map((row) => row.reason)).toEqual([`${token} 50x doneXnow`]);
  });

  it('bounds the entries by calendar days in the zone the panel names, both days included', async () => {
    const userId = randomUUID();
    const HOURS_PER_DAY = 24;
    const answer = await rolledBack(database, async (tx) => {
      // Noon UTC on four days, then 22:30 UTC on the third, which is already the fourth in Cairo.
      for (const day of [1, 2, 3, 4]) {
        await world.rows.auditEntry(tx, {
          adminId: actorId,
          action: `probe.day${day}`,
          targetType: 'user',
          targetId: userId,
          occurredAt: new Date(addHours(YEAR_2099, (day - 1) * HOURS_PER_DAY + 12)),
        });
      }
      await world.rows.auditEntry(tx, {
        adminId: actorId,
        action: 'probe.late',
        targetType: 'user',
        targetId: userId,
        occurredAt: new Date('2099-01-03T22:30:00Z'),
      });
      return query().list(tx, {
        targetId: userId,
        from: '2099-01-02',
        to: '2099-01-03',
        timeZone: 'Africa/Cairo',
        page: 1,
      });
    });
    expect(answer.rows.map((row) => row.action)).toEqual(['probe.day3', 'probe.day2']);
  });

  it('pages by admin_list_page_size, the total counting every page', async () => {
    const userId = randomUUID();
    const [first, second] = await rolledBack(database, async (tx) => {
      for (const minute of [1, 2, 3]) {
        await entry(tx, { action: `probe.step${minute}`, targetId: userId, minute });
      }
      return [
        await query({ pageSize: 2 }).list(tx, { targetId: userId, page: 1 }),
        await query({ pageSize: 2 }).list(tx, { targetId: userId, page: 2 }),
      ] as const;
    });
    expect(first).toMatchObject({ total: 3 });
    expect(first.rows.map((row) => row.action)).toEqual(['probe.step3', 'probe.step2']);
    expect(second.rows.map((row) => row.action)).toEqual(['probe.step1']);
  });
});

describe('audit.get', () => {
  it('answers the row with the two snapshots as stored', async () => {
    const userId = randomUUID();
    const answer = await rolledBack(database, async (tx) => {
      const entryId = await world.rows.auditEntry(tx, {
        adminId: actorId,
        action: 'credential.correct',
        targetType: 'credential',
        targetId: userId,
        occurredAt: at(1),
        reason: 'خطأ في السند',
        before: { riwaya: 'حفص' },
        after: { riwaya: 'ورش' },
      });
      return query().get(tx, entryId);
    });
    expect(answer).toMatchObject({
      action: 'credential.correct',
      targetLabel: `إجازة معلم · ${userId}`,
      reason: 'خطأ في السند',
      before: { riwaya: 'حفص' },
      after: { riwaya: 'ورش' },
    });
  });

  it('answers NOT_FOUND for an entry that does not exist', async () => {
    const error = await rolledBack(database, (tx) =>
      query()
        .get(tx, randomUUID())
        .then(
          () => null,
          (thrown: unknown) => thrown,
        ),
    );
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
