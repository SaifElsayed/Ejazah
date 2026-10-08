// T119: the push port and its stand-in (contracts/ports.md, R-HONEST-5, R-API-15).
//
// Two operations: deliver a notification to a device target, and report which targets the provider
// no longer accepts. The payload carries identifiers for deep-linking only: the notification's id
// and, where it concerns one, the enrollment's and the session's. A name or a message's text has no
// field to go in (`tsc`), and a value that is not an identifier, or a key that is not one of those
// three, is refused before anything is sent. The content is rendered in the application. Recording
// calls and induced failure are T122's.
//
// The type checks are enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { FakePushAdapter } from './fake.adapter.js';
import type { PushPayload, PushPort, PushTarget } from './push.port.js';

const NOTIFICATION = '01928c3e-7a10-7000-8000-00000000c001';
const ENROLLMENT = '01928c3e-7a10-7000-8000-00000000e001';
const SESSION = '01928c3e-7a10-7000-8000-00000000f001';

const phone: PushTarget = { token: 'device-token-1', platform: 'android' };
const tablet: PushTarget = { token: 'device-token-2', platform: 'ios' };

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
});

describe('the push stand-in (T119, R-HONEST-5)', () => {
  it('delivers a payload of identifiers to a device target', async () => {
    const push = new FakePushAdapter();

    await expect(
      push.deliver(phone, {
        notificationId: NOTIFICATION,
        enrollmentId: ENROLLMENT,
        sessionId: SESSION,
      }),
    ).resolves.toBeUndefined();
    await expect(push.deliver(tablet, { notificationId: NOTIFICATION })).resolves.toBeUndefined();
  });

  it.each([
    ['a name in an identifier field', { notificationId: NOTIFICATION, enrollmentId: 'Ahmed Ali' }],
    ['message text in an identifier field', { notificationId: 'Your payment went through' }],
    ['a key that is not an identifier', { notificationId: NOTIFICATION, title: 'Reminder' }],
    ['no notification id', { sessionId: SESSION }],
  ])('refuses %s, echoing nothing of it', async (_case, payload) => {
    const refusal = new FakePushAdapter().deliver(phone, payload as PushPayload);

    await expect(refusal).rejects.toThrow(TypeError);
    await expect(refusal).rejects.not.toThrow(/Ahmed|payment|Reminder/);
  });

  it('refuses a target with no token', async () => {
    await expect(
      new FakePushAdapter().deliver(
        { token: '', platform: 'ios' },
        { notificationId: NOTIFICATION },
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
