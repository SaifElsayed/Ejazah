// T065 (FR-176): the admin home's two queue cards and its latest actions. The cards are the
// applications waiting for a decision (with the age of the oldest in whole hours, and how many wait
// on the applicant) and the credentials waiting for review (with how many are for a subject added
// after approval); the other six cards are absent until their phases. The latest actions are the
// newest `admin_home_latest_actions` entries, leaving out the reads (owner's decision 2026-10-21).
//
// The queues' numbers are read through the identity and catalog modules' entries, whose own probes
// are `tests/db-integrity/admin-home-queues.spec.ts`; here they are stand-ins, so this spec proves
// what the home makes of them. The latest actions are over the real database, written at instants
// no other spec's rows reach and rolled back.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { addMinutes } from '@ijazah/time';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  type AdminWorld,
  buildAdmin,
  openSpecDatabase,
  rolledBack,
  SEEDED_ADMIN_SETTINGS,
  settingsOf,
} from './__fixtures__/admin.js';
import { readAdministratorName } from './admin-users.repository.js';
import { AuditQueryService } from './audit-query.service.js';
import { type HomeQueues, HomeService } from './home.service.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const NOW = new Date('2026-10-21T12:00:00Z');

/** Instants in 2099, where no other spec writes, one month for each case that writes entries. */
const JUNE_2099 = new Date('2099-06-01T00:00:00Z');
const JULY_2099 = new Date('2099-07-01T00:00:00Z');

let world: AdminWorld;
beforeEach(() => {
  world = buildAdmin(database);
});

function home(
  queues: HomeQueues,
  latest = SEEDED_ADMIN_SETTINGS['admin_home_latest_actions'],
): HomeService {
  const settings = settingsOf({ ...SEEDED_ADMIN_SETTINGS, admin_home_latest_actions: latest });
  return new HomeService({
    settings,
    audit: new AuditQueryService({
      settings,
      names: { person: async () => null, administrator: readAdministratorName },
    }),
    queues,
    now: () => NOW,
  });
}

const quietQueues: HomeQueues = {
  applications: async () => ({ open: 0, oldestSubmittedAt: null, waitingOnApplicant: 0 }),
  credentials: async () => ({ open: 0, addedSubjects: 0, oldestSubmittedAt: null }),
};

describe('home.summary', () => {
  it('shows the two queue cards: open applications with the oldest’s age in whole hours, and credentials', async () => {
    const summary = await rolledBack(database, (tx) =>
      home({
        applications: async () => ({
          open: 3,
          oldestSubmittedAt: new Date('2026-10-18T09:30:00Z'),
          waitingOnApplicant: 2,
        }),
        credentials: async () => ({
          open: 4,
          addedSubjects: 1,
          oldestSubmittedAt: new Date('2026-10-20T11:30:00Z'),
        }),
      }).summary(tx),
    );
    expect(summary.queues).toEqual({
      applications: { open: 3, oldestAgeHours: 74, waitingOnApplicant: 2 },
      // The credentials card says its oldest's age as the applications card does (B14d).
      credentials: { open: 4, oldestAgeHours: 24, addedSubjects: 1 },
    });
  });

  it('leaves the oldest’s age out when no application is open', async () => {
    const summary = await rolledBack(database, (tx) => home(quietQueues).summary(tx));
    expect(summary.queues.applications).toEqual({ open: 0, waitingOnApplicant: 0 });
    expect(summary.queues.credentials).toEqual({ open: 0, addedSubjects: 0 });
  });

  it('shows the newest admin_home_latest_actions entries, newest first, leaving out the reads', async () => {
    const { adminId } = await world.createAdministrator({ displayName: 'عمر فاروق' });
    const summary = await rolledBack(database, async (tx) => {
      // Eight actions in the year 2099, where no other spec writes, and a read newer than all of them.
      for (const minute of [1, 2, 3, 4, 5, 6, 7, 8]) {
        await world.rows.auditEntry(tx, {
          adminId,
          action: `probe.step${minute}`,
          targetType: 'user',
          targetId: randomUUID(),
          occurredAt: new Date(addMinutes(JUNE_2099, minute)),
        });
      }
      await world.rows.auditEntry(tx, {
        adminId,
        action: 'home.read',
        targetType: 'admin',
        targetId: adminId,
        occurredAt: new Date(addMinutes(JUNE_2099, 9)),
      });
      return home(quietQueues).summary(tx);
    });
    expect(summary.latestActions.map((row) => row.action)).toEqual([
      'probe.step8',
      'probe.step7',
      'probe.step6',
      'probe.step5',
      'probe.step4',
      'probe.step3',
      'probe.step2',
    ]);
    expect(summary.latestActions[0]).toMatchObject({ adminName: 'عمر فاروق', targetType: 'user' });
  });

  it('reads how many latest actions to show from settings', async () => {
    const { adminId } = await world.createAdministrator();
    const summary = await rolledBack(database, async (tx) => {
      for (const minute of [1, 2, 3]) {
        await world.rows.auditEntry(tx, {
          adminId,
          action: `probe.step${minute}`,
          targetType: 'user',
          targetId: randomUUID(),
          occurredAt: new Date(addMinutes(JULY_2099, minute)),
        });
      }
      return home(quietQueues, 2).summary(tx);
    });
    expect(summary.latestActions.map((row) => row.action)).toEqual(['probe.step3', 'probe.step2']);
  });
});
