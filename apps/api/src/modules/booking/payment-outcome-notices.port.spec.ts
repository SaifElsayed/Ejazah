// 005:T016 of specs/005-certification (FR-619; SRS DEC-70; the note under T016, Q-N2 (a), Q-N3 (a)):
// which outcome booking's one writer pushes, and the transaction a payment outcome is recorded on.
// Written before the port, and run red first.
//
//   - the mapping (Q-N2 (a)): `confirmed` → `payment_confirmed`; `order_failed` → `payment_failed`;
//     `cancelled` with `payment_expired` → `payment_expired`; `cancelled` with `payment_failed` →
//     none (its order's failure was already pushed); every other outcome, `slot_unavailable`
//     included, → none;
//   - `withOutcomeNotices`: the transaction runs with an after-commit list of its own bound to it,
//     unbound when it ends; the work queued on it runs once the transaction has committed, and
//     never after a rollback (a refused `'confirm'` attempt drops its push).
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import type {
  EnrollmentCancellationReason,
  EnrollmentOutcome,
} from './enrollment-events.repository.js';
import { paymentNoticeOf, withOutcomeNotices } from './payment-outcome-notices.port.js';

const ENROLLMENT = '019a4a00-0000-7000-8000-00000000e001';
const PAYMENT = '019a4a00-0000-7000-8000-00000000f001';
const AT = new Date('2026-11-18T10:00:00Z');

const cancelled = (cancellationReason: EnrollmentCancellationReason): EnrollmentOutcome => ({
  kind: 'cancelled',
  enrollmentId: ENROLLMENT,
  cancellationReason,
  occurredAt: AT,
});

describe('paymentNoticeOf: which outcome is pushed (Q-N2 (a))', () => {
  it('a confirmation is payment_confirmed', () => {
    expect(
      paymentNoticeOf({
        kind: 'confirmed',
        enrollmentId: ENROLLMENT,
        paymentId: PAYMENT,
        occurredAt: AT,
      }),
    ).toBe('payment_confirmed');
  });

  it('a failed order is payment_failed', () => {
    expect(
      paymentNoticeOf({
        kind: 'order_failed',
        enrollmentId: ENROLLMENT,
        paymentId: PAYMENT,
        occurredAt: AT,
      }),
    ).toBe('payment_failed');
  });

  it('a cancellation for an expired payment is payment_expired', () => {
    expect(paymentNoticeOf(cancelled('payment_expired'))).toBe('payment_expired');
  });

  it('a cancellation for a failed payment is none: its order’s failure was already pushed', () => {
    expect(paymentNoticeOf(cancelled('payment_failed'))).toBeNull();
  });

  it.each([
    'slot_unavailable',
    'admin',
    'gender_correction',
    'teacher_suspended',
    'checkout_abandoned',
    'account_deleted',
  ] as const)('a cancellation for %s is none (DEC-70)', (reason) => {
    expect(paymentNoticeOf(cancelled(reason))).toBeNull();
  });

  it.each([
    'completed',
    'terminated_no_show',
    'restored',
    'slot_released',
    'slot_hold_ended',
  ] as const)('%s is none', (kind) => {
    expect(paymentNoticeOf({ kind, enrollmentId: ENROLLMENT, occurredAt: AT })).toBeNull();
  });
});

describe('withOutcomeNotices: the transaction’s own after-commit list (Q-N3 (a))', () => {
  /** A transaction as `$transaction` runs one: the work, then the commit, or the rollback. */
  function opener(trace: string[], commit = true) {
    const tx = {} as Transaction;
    return {
      tx,
      open: async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
        trace.push('begin');
        const answer = await work(tx);
        if (!commit) {
          trace.push('rollback');
          throw new Error('the commit failed');
        }
        trace.push('commit');
        return answer;
      },
    };
  }

  it('binds a list that takes work to the transaction while it runs, and unbinds it after', async () => {
    const trace: string[] = [];
    const { tx, open } = opener(trace);
    const seen = await withOutcomeNotices(open, async (on) => {
      expect(on).toBe(tx);
      return publisherOn(on)?.afterCommitDo !== undefined;
    });
    expect(seen).toBe(true);
    expect(publisherOn(tx)).toBeUndefined();
  });

  it('runs the work queued on it once the transaction has committed, and answers the work’s answer', async () => {
    const trace: string[] = [];
    const { open } = opener(trace);
    const answered = await withOutcomeNotices(open, async (on) => {
      publisherOn(on)?.afterCommitDo?.(() => trace.push('enqueue'));
      trace.push('record');
      return 'done';
    });
    expect(answered).toBe('done');
    expect(trace).toEqual(['begin', 'record', 'commit', 'enqueue']);
  });

  it('drops the work queued on it when the transaction rolls back, and rethrows', async () => {
    const trace: string[] = [];
    const { tx, open } = opener(trace, false);
    await expect(
      withOutcomeNotices(open, async (on) => {
        publisherOn(on)?.afterCommitDo?.(() => trace.push('enqueue'));
        trace.push('record');
      }),
    ).rejects.toThrow('the commit failed');
    expect(trace).toEqual(['begin', 'record', 'rollback']);
    expect(publisherOn(tx)).toBeUndefined();
  });

  it('drops the work queued on it when the work throws (a refused confirm attempt)', async () => {
    const trace: string[] = [];
    const { open } = opener(trace);
    await expect(
      withOutcomeNotices(open, async (on) => {
        publisherOn(on)?.afterCommitDo?.(() => trace.push('enqueue'));
        throw new Error('refused by the database');
      }),
    ).rejects.toThrow('refused by the database');
    expect(trace).toEqual(['begin']);
  });

  it('gives each transaction a list of its own: a second one does not send the first one’s work', async () => {
    const trace: string[] = [];
    const first = opener(trace, false);
    await withOutcomeNotices(first.open, async (on) => {
      publisherOn(on)?.afterCommitDo?.(() => trace.push('first'));
    }).catch(() => undefined);
    const second = opener(trace);
    await withOutcomeNotices(second.open, async (on) => {
      publisherOn(on)?.afterCommitDo?.(() => trace.push('second'));
    });
    expect(trace.filter((step) => step === 'first' || step === 'second')).toEqual(['second']);
  });
});
