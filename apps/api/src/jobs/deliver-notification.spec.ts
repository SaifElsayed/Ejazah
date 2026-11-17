// T005 of specs/005-certification (FR-620, FR-621; R-405, R-406): the `deliver-notification` job,
// its handler called directly over in-memory stores and the push stand-in (no queue, no database).
// A row is pushed to each of the user's devices with the kind's fixed text in the user's language
// and the ids alone, then marked; a row already pushed is skipped, so a redelivery sends nothing
// more (the double-run assertion, R-API-14); a delivery that reaches no device throws for the
// queue's retries; the tokens the provider no longer accepts are removed through identity's store.
// The push port is a stand-in spelled in this spec (R-API-4). The renderer over the generated
// copy refuses a missing text and one holding an ICU argument.
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_KINDS } from '../modules/notifications/index.js';
import type { NotificationDelivery } from '../modules/notifications/index.js';
import type {
  PushMessage,
  PushPayload,
  PushPort,
  PushTarget,
} from '../platform/ports/push/push.port.js';
import { StandIn } from '../platform/ports/stand-in.js';
import {
  deliverNotification,
  PushNotDelivered,
  pushCopyRenderer,
  type PushLanguage,
  type PushRecipient,
  type PushRenderer,
} from './deliver-notification.js';
import { runOnceAndTwice } from './double-run.js';

const NOTIFICATION = '0199f6a0-0000-7000-8000-00000000c001';
const USER = '0199f6a0-0000-7000-8000-0000000000a1';
const ENROLLMENT = '0199f6a0-0000-7000-8000-00000000e001';
const SESSION = '0199f6a0-0000-7000-8000-00000000f001';
const NOW = new Date('2026-11-17T08:00:00Z');

const phone: PushTarget = { token: 'device-token-phone', platform: 'android' };
const tablet: PushTarget = { token: 'device-token-tablet', platform: 'ios' };

/**
 * The push stand-in's behaviour, spelled here, since a spec may not name an adapter (R-API-4): each
 * call recorded, a failure when told (T122), and the devices the provider no longer accepts.
 */
class SpecPush extends StandIn<PushPort> implements PushPort {
  readonly #stale = new Set<string>();

  deliver(target: PushTarget, payload: PushPayload, message: PushMessage): Promise<void> {
    const failure = this.attempt('deliver', [target, payload, message]);
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }

  findStaleTargets(targets: readonly PushTarget[]): Promise<readonly PushTarget[]> {
    const failure = this.attempt('findStaleTargets', [targets]);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve(targets.filter((target) => this.#stale.has(target.token)));
  }

  markStale(token: string): void {
    this.#stale.add(token);
  }
}

const render: PushRenderer = (kind, language) => ({
  title: `${language}:${kind}:title`,
  body: `${language}:${kind}:body`,
});

interface Line {
  readonly level: 'info' | 'warn';
  readonly fields: Readonly<Record<string, unknown>>;
}

function worldOf({
  pushedAt = null,
  recipient = { language: 'ar', targets: [phone, tablet] } as PushRecipient | null,
  exists = true,
}: {
  pushedAt?: Date | null;
  recipient?: PushRecipient | null;
  exists?: boolean;
} = {}) {
  const row: { current: NotificationDelivery } = {
    current: {
      id: NOTIFICATION,
      userId: USER,
      kind: 'session_reminder',
      payload: { enrollmentId: ENROLLMENT, sessionId: SESSION },
      pushedAt,
    },
  };
  let tokens = recipient === null ? [] : [...recipient.targets];
  const lines: Line[] = [];
  const push = new SpecPush();
  const job = deliverNotification({
    notifications: {
      find: async (id) => (exists && id === NOTIFICATION ? row.current : null),
      markPushed: async (_id, at) => {
        if (row.current.pushedAt === null) row.current = { ...row.current, pushedAt: at };
      },
    },
    recipients: {
      targetsOf: async (userId) =>
        recipient === null || userId !== USER ? null : { ...recipient, targets: tokens },
      removeStale: async (userId, removed) => {
        expect(userId).toBe(USER);
        tokens = tokens.filter((target) => !removed.includes(target.token));
      },
    },
    push,
    render,
    log: {
      info: (fields) => void lines.push({ level: 'info', fields }),
      warn: (fields) => void lines.push({ level: 'warn', fields }),
    },
    clock: () => NOW,
  });
  return {
    job,
    push,
    lines,
    row,
    tokens: () => tokens.map((target) => target.token),
    deliveries: () => push.calls.filter((call) => call.operation === 'deliver'),
  };
}

const run = (world: ReturnType<typeof worldOf>) =>
  world.job.handle({ notificationId: NOTIFICATION });

describe('deliver-notification: one delivery (T005, FR-620, FR-621)', () => {
  it("pushes to each device with the kind's text in the user's language and the ids alone, then marks it", async () => {
    const world = worldOf();

    await run(world);

    const message = { title: 'ar:session_reminder:title', body: 'ar:session_reminder:body' };
    const payload = { notificationId: NOTIFICATION, enrollmentId: ENROLLMENT, sessionId: SESSION };
    expect(world.deliveries()).toEqual([
      { operation: 'deliver', args: [phone, payload, message] },
      { operation: 'deliver', args: [tablet, payload, message] },
    ]);
    expect(world.row.current.pushedAt).toEqual(NOW);
  });

  it('pushes in English to a user whose language is English', async () => {
    const world = worldOf({ recipient: { language: 'en', targets: [phone] } });

    await run(world);

    expect(world.deliveries()[0]?.args[2]).toEqual({
      title: 'en:session_reminder:title',
      body: 'en:session_reminder:body',
    });
  });

  it('carries the id alone, and refuses anything that is not one', async () => {
    const { job } = worldOf();
    expect(job.name).toBe('deliver-notification');
    expect(job.schedule).toBeUndefined();
    await expect(job.handle({ notificationId: 'Ahmed Ali' })).rejects.toThrow();
    await expect(job.handle({})).rejects.toThrow();
  });
});

describe('deliver-notification: idempotent on pushed_at (T005, R-API-14)', () => {
  it('pushes once however many times it runs', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => worldOf(),
      run,
      observe: (world) => ({
        deliveries: world.deliveries().length,
        pushedAt: world.row.current.pushedAt,
        tokens: world.tokens(),
      }),
    });

    expect(once).toEqual({ deliveries: 2, pushedAt: NOW, tokens: [phone.token, tablet.token] });
    expect(twice).toEqual(once);
  });

  it('skips a row already pushed, sending nothing and logging the id and the reason', async () => {
    const world = worldOf({ pushedAt: new Date('2026-11-17T07:00:00Z') });

    await run(world);

    expect(world.push.calls).toEqual([]);
    expect(world.lines).toEqual([
      { level: 'info', fields: { notificationId: NOTIFICATION, reason: 'already_pushed' } },
    ]);
  });

  it.each([
    [
      'a row that is not there',
      { exists: false },
      { notificationId: NOTIFICATION, reason: 'not_found' },
    ],
    [
      'a deleted user',
      { recipient: null },
      { notificationId: NOTIFICATION, userId: USER, reason: 'recipient_deleted' },
    ],
    [
      'a user with no device',
      { recipient: { language: 'ar', targets: [] } as PushRecipient },
      { notificationId: NOTIFICATION, userId: USER, reason: 'no_device' },
    ],
  ])('skips %s, logging ids and a reason', async (_case, options, fields) => {
    const world = worldOf(options);

    await run(world);

    expect(world.push.calls).toEqual([]);
    expect(world.lines).toEqual([{ level: 'info', fields }]);
  });
});

describe('deliver-notification: retries (T005, FR-620)', () => {
  it('throws for the queue to retry when no device took the push, leaving pushed_at NULL', async () => {
    const world = worldOf({ recipient: { language: 'ar', targets: [phone] } });
    world.push.failNext('deliver', new Error('provider unavailable'));

    await expect(run(world)).rejects.toBeInstanceOf(PushNotDelivered);
    expect(world.row.current.pushedAt).toBeNull();
    expect(world.lines).toEqual([
      {
        level: 'warn',
        fields: {
          notificationId: NOTIFICATION,
          userId: USER,
          devices: 1,
          reason: 'not_delivered',
          errorName: 'Error',
        },
      },
    ]);

    await run(world);

    expect(world.deliveries()).toHaveLength(2);
    expect(world.row.current.pushedAt).toEqual(NOW);
  });

  it('marks a push that reached some devices, logging the counts, and is not retried', async () => {
    const world = worldOf();
    world.push.failNext('deliver', new Error('provider unavailable'));

    await run(world);

    expect(world.row.current.pushedAt).toEqual(NOW);
    expect(world.lines).toContainEqual({
      level: 'warn',
      fields: {
        notificationId: NOTIFICATION,
        userId: USER,
        delivered: 1,
        failed: 1,
        reason: 'partly_delivered',
      },
    });
  });
});

describe('deliver-notification: stale tokens (T005, R-405)', () => {
  it('removes the tokens the provider no longer accepts, logging a count and never a token', async () => {
    const world = worldOf();
    world.push.markStale(tablet.token);

    await run(world);

    expect(world.tokens()).toEqual([phone.token]);
    expect(world.lines).toEqual([
      {
        level: 'info',
        fields: {
          notificationId: NOTIFICATION,
          userId: USER,
          removed: 1,
          reason: 'provider_no_longer_accepts',
        },
      },
    ]);
    expect(JSON.stringify(world.lines)).not.toContain('device-token');
  });

  it('keeps the row pushed and the tokens when the provider cannot be asked, logging the reason', async () => {
    const world = worldOf();
    world.push.markStale(tablet.token);
    world.push.failNext('findStaleTargets', new Error('provider unavailable'));

    await run(world);

    expect(world.row.current.pushedAt).toEqual(NOW);
    expect(world.tokens()).toEqual([phone.token, tablet.token]);
    expect(world.lines).toEqual([
      {
        level: 'warn',
        fields: {
          notificationId: NOTIFICATION,
          userId: USER,
          reason: 'stale_check_failed',
          errorName: 'Error',
        },
      },
    ]);
  });
});

/** A catalogue holding every kind's two texts in both languages, as E2's keys will. */
function copyOf(text: (language: PushLanguage, kind: string, part: string) => string) {
  const of = (language: PushLanguage) => ({
    notifications: {
      push: Object.fromEntries(
        NOTIFICATION_KINDS.map((kind) => [
          kind,
          { title: text(language, kind, 'title'), body: text(language, kind, 'body') },
        ]),
      ),
    },
  });
  return { ar: of('ar'), en: of('en') };
}

describe('pushCopyRenderer: fixed text only (T005, Q5 (a))', () => {
  const copy = copyOf((language, kind, part) => `${language} ${kind} ${part}`);

  it("renders the seven kinds' titles and bodies in both languages, none holding an ICU argument", () => {
    const renderer = pushCopyRenderer(copy);

    for (const language of ['ar', 'en'] as const) {
      for (const kind of NOTIFICATION_KINDS) {
        const message = renderer(kind, language);
        expect(message).toEqual({
          title: `${language} ${kind} title`,
          body: `${language} ${kind} body`,
        });
        expect(`${message.title}${message.body}`).not.toMatch(/[{}]/);
      }
    }
  });

  it('refuses a text holding an ICU argument, naming the key and never the text', () => {
    const withArgument = copyOf((language, kind, part) =>
      language === 'en' && kind === 'payment_failed' && part === 'body'
        ? 'Your payment to {name} failed'
        : `${language} ${kind} ${part}`,
    );

    expect(() => pushCopyRenderer(withArgument)).toThrow('notifications.push.payment_failed.body');
    expect(() => pushCopyRenderer(withArgument)).not.toThrow(/Your payment/);
  });

  it('refuses a catalogue missing a text, naming the key', () => {
    const missing = copyOf((language, kind, part) =>
      language === 'ar' && kind === 'session_reminder' && part === 'title'
        ? ''
        : `${language} ${kind} ${part}`,
    );

    expect(() => pushCopyRenderer(missing)).toThrow('notifications.push.session_reminder.title');
    expect(() => pushCopyRenderer({ ar: {}, en: {} })).toThrow(/notifications\.push\./);
  });
});
