// T119: the push port and its stand-in (contracts/ports.md, R-HONEST-5, R-API-15).
//
// Two operations: deliver a notification to a device target, and report which targets the provider
// no longer accepts. The payload carries identifiers for deep-linking only: the notification's id
// and, where it concerns one, the enrollment's and the session's. A name or a message's text has no
// field to go in (`tsc`), and a value that is not an identifier, or a key that is not one of those
// three, is refused before anything is sent. The stand-in records what it was asked and fails an
// operation when told (T122).
//
// T005 of specs/005-certification (Q5 (a); R-HONEST-5's note of 2026-11-17): `deliver` takes the
// kind's fixed title and body apart from the payload, as `message`, so the device shows the push
// with the application closed; the payload stays identifiers only. The stand-in records the message.
//
// The type checks are enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { FakePushAdapter } from './fake.adapter.js';
import type { PushMessage, PushPayload, PushPort, PushTarget } from './push.port.js';

const NOTIFICATION = '01928c3e-7a10-7000-8000-00000000c001';
const ENROLLMENT = '01928c3e-7a10-7000-8000-00000000e001';
const SESSION = '01928c3e-7a10-7000-8000-00000000f001';

const phone: PushTarget = { token: 'device-token-1', platform: 'android' };
const tablet: PushTarget = { token: 'device-token-2', platform: 'ios' };
const message: PushMessage = { title: 'Session reminder', body: 'Your session starts soon.' };

describe('the push port (T119, contracts/ports.md)', () => {
  it('has two operations: deliver to a target, and report stale targets', () => {
    expectTypeOf<keyof PushPort>().toEqualTypeOf<'deliver' | 'findStaleTargets'>();
  });

  it('carries identifiers for deep-linking only (R-HONEST-5)', () => {
    expectTypeOf<keyof PushPayload>().toEqualTypeOf<
      'notificationId' | 'enrollmentId' | 'sessionId'
    >();
    const withText: PushPayload = {
      notificationId: NOTIFICATION,
      // @ts-expect-error -- T119: a push payload has no field for a message's text (R-HONEST-5)
      body: 'Your session with the teacher starts in 15 minutes',
    };
    expect(withText).toBeDefined();
  });

  it('takes the fixed title and body apart from the payload (T005, Q5 (a))', () => {
    expectTypeOf<keyof PushMessage>().toEqualTypeOf<'title' | 'body'>();
    expectTypeOf<PushPort['deliver']>().parameters.toEqualTypeOf<
      [PushTarget, PushPayload, PushMessage]
    >();
  });
});

describe('the push stand-in (T119, R-HONEST-5)', () => {
  it('delivers a payload of identifiers to a device target', async () => {
    const push = new FakePushAdapter();

    await expect(
      push.deliver(
        phone,
        { notificationId: NOTIFICATION, enrollmentId: ENROLLMENT, sessionId: SESSION },
        message,
      ),
    ).resolves.toBeUndefined();
    await expect(
      push.deliver(tablet, { notificationId: NOTIFICATION }, message),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['a name in an identifier field', { notificationId: NOTIFICATION, enrollmentId: 'Ahmed Ali' }],
    ['message text in an identifier field', { notificationId: 'Your payment went through' }],
    ['a key that is not an identifier', { notificationId: NOTIFICATION, title: 'Reminder' }],
    ['no notification id', { sessionId: SESSION }],
  ])('refuses %s, echoing nothing of it', async (_case, payload) => {
    const refusal = new FakePushAdapter().deliver(phone, payload as PushPayload, message);

    await expect(refusal).rejects.toThrow(TypeError);
    await expect(refusal).rejects.not.toThrow(/Ahmed|payment|Reminder/);
  });

  it('refuses a target with no token', async () => {
    await expect(
      new FakePushAdapter().deliver(
        { token: '', platform: 'ios' },
        { notificationId: NOTIFICATION },
        message,
      ),
    ).rejects.toThrow(RangeError);
  });

  it('reports none of the given targets stale until the provider stops accepting one', async () => {
    const push = new FakePushAdapter();
    expect(await push.findStaleTargets([phone, tablet])).toEqual([]);

    push.markStale(tablet.token);

    expect(await push.findStaleTargets([phone, tablet])).toEqual([tablet]);
    expect(await push.findStaleTargets([phone])).toEqual([]);
  });
});

describe('the push stand-in: records and induced failure (T122)', () => {
  it('records each delivery, its message included (T005), and each stale-target question', async () => {
    const push = new FakePushAdapter();
    await push.deliver(phone, { notificationId: NOTIFICATION }, message);
    await push.findStaleTargets([phone, tablet]);

    expect(push.calls).toEqual([
      { operation: 'deliver', args: [phone, { notificationId: NOTIFICATION }, message] },
      { operation: 'findStaleTargets', args: [[phone, tablet]] },
    ]);
  });

  it.each(['deliver', 'findStaleTargets'] as const)('fails %s when told', async (operation) => {
    const push = new FakePushAdapter();
    push.failNext(operation, new Error('provider unavailable'));

    const call =
      operation === 'deliver'
        ? push.deliver(phone, { notificationId: NOTIFICATION }, message)
        : push.findStaleTargets([phone]);

    await expect(call).rejects.toThrow('provider unavailable');
  });
});
