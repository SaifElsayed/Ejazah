// T075, the payments half (FR-191, FR-PAYG-4, FR-PAYG-15, R-MONEY-8, R-114, R-121): a signed
// recipient event is recorded once in `payment_events` and hands its verdict to the identity
// module's two entries, on the same transaction, by the hash of the reference it carries.
//
// Over the real database (the pipeline's migrated Postgres, as the identity specs run) and with the
// identity entries injected as recorders, so this spec proves what the payments module does and
// nothing of what identity does with the verdict (lane A of B15 holds those specs). Each event id
// is fresh, so specs running together never meet. The log is captured line by line and the error
// reporting recorded, so "nothing of the raw body is logged" is a sweep over both.
import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase, openDatabase, type Database } from '../../platform/db/prisma.repository.js';
import { createLogger } from '../../platform/logging/logger.js';
import type { GatewayEvent } from '../../platform/ports/payment/payment.port.js';
import { payoutRefHash } from '../identity/index.js';
import { EventRows } from './__fixtures__/event-rows.repository.js';
import {
  type Receipt,
  RecipientEventsService,
  type RecipientVerdicts,
} from './recipient-events.service.js';

function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('payments specs: DATABASE_URL is not set (quickstart §1)');
  }
  return url;
}

let database: Database;

beforeAll(() => {
  database = openDatabase(databaseUrl(), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  });
});

afterAll(() => closeDatabase(database));

/** One call identity's entries received, with whether it came on a transaction. */
interface VerdictCall {
  readonly entry: 'markPayoutVerified' | 'markPayoutRejected';
  readonly onTransaction: boolean;
  readonly refHash: string;
  readonly at?: Date;
  readonly reason?: string | undefined;
}

/** Identity's two entries as recorders, answering `matches` (false: no teacher holds the hash). */
function recordingIdentity(matches = true, failure?: Error) {
  const calls: VerdictCall[] = [];
  const answer = (): Promise<boolean> =>
    failure === undefined ? Promise.resolve(matches) : Promise.reject(failure);
  const identity: RecipientVerdicts = {
    payoutRefHash,
    markPayoutVerified: (tx, refHash, at) => {
      calls.push({ entry: 'markPayoutVerified', onTransaction: tx !== undefined, refHash, at });
      return answer();
    },
    markPayoutRejected: (tx, refHash, reason) => {
      calls.push({ entry: 'markPayoutRejected', onTransaction: tx !== undefined, refHash, reason });
      return answer();
    },
  };
  return { identity, calls };
}

function harness(identity: RecipientVerdicts) {
  const lines: string[] = [];
  const reported: Error[] = [];
  const log = createLogger({
    level: 'info',
    destination: { write: (line: string) => void lines.push(line) },
  });
  const service = new RecipientEventsService({
    database,
    identity,
    log,
    report: (error) => void reported.push(error),
  });
  return { service, lines, reported };
}

const RECEIVED_AT = new Date('2026-10-26T09:00:00.000Z');
const VERIFIED_AT = new Date('2026-10-26T09:00:00.250Z');

/** A recipient event as the port parsed it, and the raw body it came in (the stand-in's form). */
function recipientEvent(
  type: 'recipient_verified' | 'recipient_rejected',
  options: { readonly reason?: string; readonly recipientRef?: string } = {},
): { readonly event: GatewayEvent; readonly receipt: Receipt; readonly recipientRef: string } {
  const providerEventId = `fake_evt_${randomUUID()}`;
  const recipientRef = options.recipientRef ?? `fake_rcp_${randomUUID()}`;
  const body =
    options.reason === undefined
      ? { id: providerEventId, type, recipient: recipientRef }
      : { id: providerEventId, type, recipient: recipientRef, reason: options.reason };
  const event: GatewayEvent =
    type === 'recipient_verified'
      ? { type, providerEventId, recipientRef }
      : {
          type,
          providerEventId,
          recipientRef,
          ...(options.reason === undefined ? {} : { reason: options.reason }),
        };
  return {
    event,
    recipientRef,
    receipt: {
      rawBody: Buffer.from(JSON.stringify(body)),
      receivedAt: RECEIVED_AT,
      signatureVerifiedAt: VERIFIED_AT,
    },
  };
}

function rowsOf(providerEventId: string) {
  return new EventRows(database).of(providerEventId);
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

describe('a signed recipient event (T075, FR-191, R-114)', () => {
  it('is recorded once, with the hash of its raw body and no payment, and marks the teacher verified', async () => {
    const { identity, calls } = recordingIdentity();
    const { service } = harness(identity);
    const { event, receipt, recipientRef } = recipientEvent('recipient_verified');

    await expect(service.record(event, receipt)).resolves.toBe('applied');

    expect(await rowsOf(event.providerEventId)).toEqual([
      {
        paymentId: null,
        providerEventId: event.providerEventId,
        eventType: 'recipient_verified',
        signatureVerifiedAt: VERIFIED_AT,
        payloadHash: sha256(receipt.rawBody),
        receivedAt: RECEIVED_AT,
      },
    ]);
    expect(calls).toEqual([
      {
        entry: 'markPayoutVerified',
        onTransaction: true,
        refHash: sha256(recipientRef),
        at: VERIFIED_AT,
      },
    ]);
  });

  it("hands a rejection to identity with the gateway's reason", async () => {
    const { identity, calls } = recordingIdentity();
    const { service } = harness(identity);
    const { event, receipt, recipientRef } = recipientEvent('recipient_rejected', {
      reason: 'name mismatch',
    });

    await expect(service.record(event, receipt)).resolves.toBe('applied');

    expect(await rowsOf(event.providerEventId)).toMatchObject([
      { eventType: 'recipient_rejected', paymentId: null },
    ]);
    expect(calls).toEqual([
      {
        entry: 'markPayoutRejected',
        onTransaction: true,
        refHash: sha256(recipientRef),
        reason: 'name mismatch',
      },
    ]);
  });

  it('hands a rejection without a reason to identity as no reason', async () => {
    const { identity, calls } = recordingIdentity();
    const { service } = harness(identity);
    const { event, receipt } = recipientEvent('recipient_rejected');

    await service.record(event, receipt);

    expect(calls).toMatchObject([{ entry: 'markPayoutRejected', reason: undefined }]);
  });
});

describe('a replayed provider event id (FR-PAYG-4, R-MONEY-8)', () => {
  it('changes nothing: no second row, no second verdict', async () => {
    const { identity, calls } = recordingIdentity();
    const { service } = harness(identity);
    const { event, receipt } = recipientEvent('recipient_verified');

    await expect(service.record(event, receipt)).resolves.toBe('applied');
    await expect(
      service.record(event, { ...receipt, receivedAt: new Date('2026-10-26T10:00:00Z') }),
    ).resolves.toBe('replayed');

    expect(await rowsOf(event.providerEventId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('changes nothing when the two deliveries race', async () => {
    const { identity, calls } = recordingIdentity();
    const { service } = harness(identity);
    const { event, receipt } = recipientEvent('recipient_rejected', { reason: 'closed account' });

    const outcomes = await Promise.all([
      service.record(event, receipt),
      service.record(event, receipt),
    ]);

    expect(outcomes.sort()).toEqual(['applied', 'replayed']);
    expect(await rowsOf(event.providerEventId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('a reference no teacher holds (R-114)', () => {
  it('is recorded, reported and logged without the body, and changes no row', async () => {
    const { identity, calls } = recordingIdentity(false);
    const { service, lines, reported } = harness(identity);
    const { event, receipt } = recipientEvent('recipient_verified');

    await expect(service.record(event, receipt)).resolves.toBe('unmatched');

    expect(await rowsOf(event.providerEventId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain(event.providerEventId);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'warn',
      providerEventId: event.providerEventId,
      eventType: 'recipient_verified',
    });
  });
});

describe('an order event, which no order of this phase can produce (owner, B15 check)', () => {
  it.each(['paid', 'failed', 'expired', 'refunded'] as const)(
    'a %s event is reported and acknowledged, writing nothing and calling nobody',
    async (type) => {
      const { identity, calls } = recordingIdentity();
      const { service, lines, reported } = harness(identity);
      const providerEventId = `fake_evt_${randomUUID()}`;
      const event = { type, providerEventId, gatewayOrderId: 'fake_ord_1' } as GatewayEvent;
      const rawBody = Buffer.from(
        JSON.stringify({ id: providerEventId, type, order: 'fake_ord_1' }),
      );

      await expect(
        service.record(event, {
          rawBody,
          receivedAt: RECEIVED_AT,
          signatureVerifiedAt: VERIFIED_AT,
        }),
      ).resolves.toBe('unexpected_order_event');

      expect(await rowsOf(providerEventId)).toEqual([]);
      expect(calls).toEqual([]);
      expect(reported).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        level: 'warn',
        providerEventId,
        eventType: type,
      });
    },
  );
});

describe('one transaction (R-MONEY-8: the event is persisted before any action)', () => {
  it('keeps no row when identity fails, so the gateway retries the event whole', async () => {
    const { identity } = recordingIdentity(true, new Error('identity is unavailable'));
    const { service } = harness(identity);
    const { event, receipt } = recipientEvent('recipient_verified');

    await expect(service.record(event, receipt)).rejects.toThrow('identity is unavailable');

    expect(await rowsOf(event.providerEventId)).toEqual([]);
  });
});

describe('nothing of the raw body leaves (R-SEC-2)', () => {
  it('neither the reference, nor the reason, nor the body reaches a log line or a report', async () => {
    const { identity } = recordingIdentity(false);
    const { service, lines, reported } = harness(identity);
    const { event, receipt, recipientRef } = recipientEvent('recipient_rejected', {
      reason: 'IBAN EG380019000500000000263180002 closed',
    });

    await service.record(event, receipt);

    const leaked = [...lines, ...reported.map((error) => `${error.message}\n${error.stack ?? ''}`)];
    expect(leaked.length).toBeGreaterThan(0);
    for (const text of leaked) {
      expect(text).not.toContain(recipientRef);
      expect(text).not.toContain('EG380019000500000000263180002');
      expect(text).not.toContain(receipt.rawBody.toString('utf8'));
      expect(text).not.toContain(sha256(recipientRef));
    }
  });
});
