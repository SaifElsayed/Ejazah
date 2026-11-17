// T004 of specs/005-certification/tasks.md (B45, lane D) — the certificate name (FR-602; ADR 0019
// D1; research R-411; app-surface.md, `account.certificateName.set`; admin-surface.md,
// `users.setCertificateName`; the note under T004, Q4 (a)).
//
// - The student sets it once: keyed under `account.certificateName.set`, the student the actor; a
//   second set is refused `CONFLICT` `already_set`, the name kept, nothing released, the refusal
//   logged with the ids and its reason only.
// - An administrator sets or changes it on the administrator kind's transaction, keyed there
//   (`runOn`) under `users.setCertificateName`; an account that is not a live student's is
//   `NOT_FOUND`, logged with the ids and its reason, nothing written.
// - Either path takes the account's lock first, writes, then hands the student's waiting requests
//   to identity's port `AwaitingNameRelease` on the same transaction (the user first, then the
//   requests, which T006 binds; `docs/ARCHITECTURE.md:197`'s dependencies against the arrows).
// - No log line carries the name.
//
// Over a store held in memory that records every call with its transaction, and an idempotency that
// runs the work on a transaction of its own (`run`) or on the one handed in (`runOn`). That an
// administrator's change never rewrites an issued certificate is
// `tests/db-integrity/certificate-name.spec.ts`'s, on the real tables.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import {
  type CertificateNameHolder,
  CertificateNameService,
  type CertificateNameStore,
} from './certificate-name.service.js';

const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b2';
const ABSENT = '0199d0a0-0000-7000-8000-0000000000b3';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const NAME = 'مريم بنت أحمد بن علي';
const OTHER_NAME = 'مريم بنت أحمد بن علي الحسني';

/** A transaction a call runs on, told apart by identity. */
const transaction = (label: string) => ({ label }) as unknown as Transaction;

/** One call the service made: the operation, the transaction it ran on and the person. */
type Call = readonly [string, Transaction, string];

class MemoryCertificateNameStore implements CertificateNameStore {
  readonly calls: Call[] = [];
  readonly #rows = new Map<string, CertificateNameHolder>();

  plant(userId: string, holder: CertificateNameHolder): void {
    this.#rows.set(userId, holder);
  }

  nameOf(userId: string): string | null | undefined {
    return this.#rows.get(userId)?.certificateName;
  }

  async lockAccount(tx: Transaction, userId: string): Promise<void> {
    this.calls.push(['lock', tx, userId]);
  }

  async read(tx: Transaction, userId: string): Promise<CertificateNameHolder | null> {
    this.calls.push(['read', tx, userId]);
    return this.#rows.get(userId) ?? null;
  }

  async write(tx: Transaction, userId: string, name: string): Promise<void> {
    this.calls.push(['write', tx, userId]);
    const row = this.#rows.get(userId);
    if (row !== undefined) this.#rows.set(userId, { ...row, certificateName: name });
  }
}

let store: MemoryCertificateNameStore;
let keyed: { readonly on: 'run' | 'runOn'; readonly request: IdempotentRequest }[];
let replayed: boolean;
let ownTransaction: Transaction;
let infos: { readonly entry: object; readonly message: string }[];
let service: CertificateNameService;

beforeEach(() => {
  store = new MemoryCertificateNameStore();
  store.plant(STUDENT, { student: true, certificateName: null });
  store.plant(TEACHER, { student: false, certificateName: null });
  keyed = [];
  replayed = false;
  ownTransaction = transaction('the student’s own transaction');
  infos = [];
  service = new CertificateNameService({
    store,
    idempotency: {
      run: async (request, effect) => {
        keyed.push({ on: 'run', request });
        return effect(ownTransaction);
      },
      runOn: async (tx, request, effect) => {
        keyed.push({ on: 'runOn', request });
        if (replayed) return { outcome: null as never, replayed: true };
        return { outcome: await effect(tx), replayed: false };
      },
    },
    awaitingNameRelease: {
      release: async (tx, studentUserId) => {
        store.calls.push(['release', tx, studentUserId]);
      },
    },
    log: {
      info: ((entry: object, message: string) => {
        infos.push({ entry, message });
      }) as never,
    },
  });
});

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown;
}

describe('the student’s own name, account.certificateName.set', () => {
  it('sets the name of a student who has none, and answers it', async () => {
    await expect(
      service.setOwn(STUDENT, { name: NAME, idempotencyKey: 'name-key-0001' }),
    ).resolves.toEqual({ name: NAME });
    expect(store.nameOf(STUDENT)).toBe(NAME);
  });

  it('keys the call under account.certificateName.set, the student the actor', async () => {
    await service.setOwn(STUDENT, { name: NAME, idempotencyKey: 'name-key-0001' });
    expect(keyed).toEqual([
      {
        on: 'run',
        request: {
          scope: 'account.certificateName.set',
          key: 'name-key-0001',
          actorId: STUDENT,
          input: { name: NAME },
        },
      },
    ]);
  });

  it('refuses a second set as CONFLICT already_set, keeping the first name and releasing nothing', async () => {
    await service.setOwn(STUDENT, { name: NAME, idempotencyKey: 'name-key-0001' });
    store.calls.length = 0;
    const refusal = await refusalOf(
      service.setOwn(STUDENT, { name: OTHER_NAME, idempotencyKey: 'name-key-0002' }),
    );
    expect(refusal.code).toBe('CONFLICT');
    expect(refusal.details).toEqual([{ path: 'certificateName', code: 'already_set' }]);
    expect(store.nameOf(STUDENT)).toBe(NAME);
    expect(store.calls.map(([operation]) => operation)).toEqual(['lock', 'read']);
  });

  it('logs the refusal with the ids and its reason only, never a name, and marks it logged', async () => {
    store.plant(STUDENT, { student: true, certificateName: NAME });
    const refusal = await refusalOf(
      service.setOwn(STUDENT, { name: OTHER_NAME, idempotencyKey: 'name-key-0002' }),
    );
    expect(isRefusalLogged(refusal)).toBe(true);
    expect(infos).toEqual([
      { entry: { userId: STUDENT, reason: 'already_set' }, message: expect.any(String) },
    ]);
    expect(JSON.stringify(infos)).not.toContain(NAME);
    expect(JSON.stringify(infos)).not.toContain(OTHER_NAME);
  });

  it('refuses an account that is not a live student’s as NOT_FOUND, writing and releasing nothing', async () => {
    for (const userId of [TEACHER, ABSENT]) {
      store.calls.length = 0;
      const refusal = await refusalOf(
        service.setOwn(userId, { name: NAME, idempotencyKey: 'name-key-0003' }),
      );
      expect(refusal.code).toBe('NOT_FOUND');
      expect(isRefusalLogged(refusal)).toBe(true);
      expect(store.calls.map(([operation]) => operation)).toEqual(['lock', 'read']);
    }
    expect(store.nameOf(TEACHER)).toBeNull();
    expect(infos.map(({ entry }) => entry)).toEqual([
      { userId: TEACHER, reason: 'not_student' },
      { userId: ABSENT, reason: 'not_student' },
    ]);
  });

  it('releases the student’s waiting requests on the setter’s transaction, after the account’s lock and the write', async () => {
    await service.setOwn(STUDENT, { name: NAME, idempotencyKey: 'name-key-0001' });
    expect(store.calls).toEqual([
      ['lock', ownTransaction, STUDENT],
      ['read', ownTransaction, STUDENT],
      ['write', ownTransaction, STUDENT],
      ['release', ownTransaction, STUDENT],
    ]);
  });
});

describe('an administrator’s change, users.setCertificateName', () => {
  const input = (targetUserId: string, name = NAME) => ({
    targetUserId,
    name,
    reason: 'طلب الطالبة تصحيح الاسم عبر الدعم',
    idempotencyKey: 'users-name-key-0001',
  });

  it('sets the name of a student who has none', async () => {
    const tx = transaction('the administrator’s transaction');
    await expect(service.setByAdministrator(tx, ADMIN, input(STUDENT))).resolves.toEqual({
      replayed: false,
    });
    expect(store.nameOf(STUDENT)).toBe(NAME);
  });

  it('changes a name already set', async () => {
    store.plant(STUDENT, { student: true, certificateName: NAME });
    const tx = transaction('the administrator’s transaction');
    await service.setByAdministrator(tx, ADMIN, input(STUDENT, OTHER_NAME));
    expect(store.nameOf(STUDENT)).toBe(OTHER_NAME);
  });

  it('keys the call on the administrator’s transaction under users.setCertificateName, the administrator the actor', async () => {
    const tx = transaction('the administrator’s transaction');
    await service.setByAdministrator(tx, ADMIN, input(STUDENT));
    expect(keyed).toEqual([
      {
        on: 'runOn',
        request: {
          scope: 'users.setCertificateName',
          key: 'users-name-key-0001',
          actorId: ADMIN,
          input: { targetUserId: STUDENT, name: NAME, reason: input(STUDENT).reason },
        },
      },
    ]);
  });

  it('releases the student’s waiting requests on the administrator’s transaction, after the account’s lock and the write', async () => {
    store.plant(STUDENT, { student: true, certificateName: NAME });
    const tx = transaction('the administrator’s transaction');
    await service.setByAdministrator(tx, ADMIN, input(STUDENT, OTHER_NAME));
    expect(store.calls).toEqual([
      ['lock', tx, STUDENT],
      ['read', tx, STUDENT],
      ['write', tx, STUDENT],
      ['release', tx, STUDENT],
    ]);
  });

  it('answers a replay of the key as replayed, writing nothing', async () => {
    replayed = true;
    const tx = transaction('the administrator’s transaction');
    await expect(service.setByAdministrator(tx, ADMIN, input(STUDENT))).resolves.toEqual({
      replayed: true,
    });
    expect(store.calls).toEqual([]);
    expect(store.nameOf(STUDENT)).toBeNull();
  });

  it('refuses an account that is not a live student’s as NOT_FOUND, logged with the ids and its reason, nothing written or released', async () => {
    const tx = transaction('the administrator’s transaction');
    for (const userId of [TEACHER, ABSENT]) {
      store.calls.length = 0;
      const refusal = await refusalOf(service.setByAdministrator(tx, ADMIN, input(userId)));
      expect(refusal.code).toBe('NOT_FOUND');
      expect(isRefusalLogged(refusal)).toBe(true);
      expect(store.calls.map(([operation]) => operation)).toEqual(['lock', 'read']);
    }
    expect(infos.map(({ entry }) => entry)).toEqual([
      { adminId: ADMIN, userId: TEACHER, reason: 'not_student' },
      { adminId: ADMIN, userId: ABSENT, reason: 'not_student' },
    ]);
  });

  it('logs the change with the ids only, never the name', async () => {
    store.plant(STUDENT, { student: true, certificateName: NAME });
    const tx = transaction('the administrator’s transaction');
    await service.setByAdministrator(tx, ADMIN, input(STUDENT, OTHER_NAME));
    expect(infos).toEqual([
      { entry: { adminId: ADMIN, userId: STUDENT }, message: expect.any(String) },
    ]);
    expect(JSON.stringify(infos)).not.toContain(NAME);
  });
});
