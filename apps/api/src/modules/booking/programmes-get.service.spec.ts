// 006:T018 (app-surface.md `programme.get`): the `programme` services' `get`, as `createBookingServices`
// builds it: `programme_renew_early_days` read before the transaction (006:T019, T020: with
// `programme_stop_request_days` and `programme_pay_reminder_hours`), the read run on one
// transaction over payments' reads handed in, and a loud failure where nothing bound them (never a
// silent «no card»). What the read answers is `programmes-reads.service.spec.ts`'.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  createProgrammeServices,
  type ProgrammeServiceDependencies,
} from './programmes.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000018f1';
const STRANGER = '0199d0a0-0000-7000-8000-0000000018f2';

function servicesOver(reads: ProgrammeServiceDependencies['reads'], asked: string[]) {
  const settings: SettingsReader = {
    read: async (key, schema) => {
      asked.push(`setting ${key}`);
      return schema.parse(3);
    },
  };
  return createProgrammeServices({
    idempotency: { run: async () => Promise.reject(new Error('not keyed')) },
    settings,
    amounts: () => {
      throw new Error('no amount');
    },
    log: { info: () => undefined },
    ...(reads === undefined ? {} : { reads }),
  });
}

describe('programme.get through the programme services (006:T018)', () => {
  it('reads the early days, then runs the read on one transaction over the bound reads', async () => {
    const asked: string[] = [];
    const tx = {
      programme: {
        findFirst: async () => {
          asked.push('read the programme');
          return null;
        },
      },
    } as unknown as Transaction;
    const services = servicesOver(
      {
        transactions: {
          run: async (work) => {
            asked.push('transaction');
            return work(tx);
          },
        },
        payments: {
          payee: { unverifiedInLiveMode: async () => false },
          monthOrders: async () => {
            throw new Error('not reached');
          },
          cardOf: async () => null,
        },
      },
      asked,
    );
    await expect(services.get(STRANGER, { enrollmentId: ENROLLMENT })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // 006:T019, T020 (B-P4): and the stop's days and the reminder's hours, read with it.
    expect(asked).toEqual([
      'setting programme_renew_early_days',
      'setting programme_stop_request_days',
      'setting programme_pay_reminder_hours',
      // B-P4 round 2 (Q-B2 (a)): the offer's window, as `programme.offer` reads it.
      'setting programme_offer_hours',
      'transaction',
      'read the programme',
    ]);
  });

  it('fails loudly where no read is bound', async () => {
    const services = servicesOver(undefined, []);
    await expect(services.get(STRANGER, { enrollmentId: ENROLLMENT })).rejects.toThrow(
      /programme\.get: its reads are not bound/,
    );
  });
});
