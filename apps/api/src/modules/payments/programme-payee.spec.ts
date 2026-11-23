// 006:T008 of specs/006-programme (FR-706b, FR-716; SRS DEC-101; PR #155 r1 N4) — «unverified in
// live mode»: true only in live mode with the teacher's payout recipient answering none, the same
// read as the checkout's split (`payoutRecipientOf`); test mode answers false and reads nothing.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { createProgrammePayee, type PaymentMode } from './programme-payee.js';

const TEACHER = '0199d0a0-0000-7000-8000-00000000a0d1';
const tx = {} as Transaction;
const cipher = { decrypt: () => 'unused' };

function payeeOf(paymentMode: PaymentMode, recipient: string | null) {
  const reads: string[] = [];
  const payee = createProgrammePayee({
    paymentMode,
    cipher,
    recipientOf: async (_tx, teacherUserId) => {
      reads.push(teacherUserId);
      return recipient;
    },
  });
  return { payee, reads };
}

describe('«unverified in live mode» (006:T008, FR-706b, DEC-101)', () => {
  it('answers true in live mode when the teacher’s payout recipient answers none', async () => {
    const { payee, reads } = payeeOf('live', null);
    await expect(payee.unverifiedInLiveMode(tx, TEACHER)).resolves.toBe(true);
    expect(reads).toEqual([TEACHER]);
  });

  it('answers false in live mode once the account is verified', async () => {
    const { payee } = payeeOf('live', 'rcpt_verified');
    await expect(payee.unverifiedInLiveMode(tx, TEACHER)).resolves.toBe(false);
  });

  it('answers false in test mode, reading nothing', async () => {
    const { payee, reads } = payeeOf('test', null);
    await expect(payee.unverifiedInLiveMode(tx, TEACHER)).resolves.toBe(false);
    expect(reads).toEqual([]);
  });
});
