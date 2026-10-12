// T155 — the `reencrypt-columns` sweep (FR-031, R-DB-8, R-SEC-10, R-API-14).
//
// While a rotation runs, the sweep reads every `_encrypted` column one at a time, in pages, and
// writes each value found under the previous key again under the current one, so the previous key
// can be retired. These cases hold it to that over in-memory columns whose values were written
// under the old key by the real cipher. The queries themselves are proven against Postgres, as the
// application role, in `tests/db-integrity/encrypted-columns.spec.ts`.
import { describe, expect, it } from 'vitest';
import {
  ColumnCipher,
  columnKeyId,
  type EncryptedColumn,
  type EncryptedValue,
} from '../platform/crypto/encryption.js';
import { runOnceAndTwice } from './double-run.js';
import { reencryptColumns, UnreadableValuesError } from './reencrypt-columns.js';

const OLD_KEY = Buffer.alloc(32, 7).toString('base64');
const NEW_KEY = Buffer.alloc(32, 9).toString('base64');
const LOST_KEY = Buffer.alloc(32, 11).toString('base64');
const MFA = 'admin_users.mfa_secret_encrypted';
const PAYOUT = 'teacher_profiles.payout_account_ref_encrypted';

const before = new ColumnCipher(OLD_KEY);
const rotating = new ColumnCipher(NEW_KEY, OLD_KEY);
const after = new ColumnCipher(NEW_KEY);

/** An in-memory column: rows by id, read in id order, written only where the value still matches. */
class FakeColumn implements EncryptedColumn {
  readonly rows = new Map<string, Uint8Array>();
  readonly calls: string[] = [];
  /** Throws on the n-th replace, as a worker stopped mid-run would. */
  failOnReplace: number | undefined;
  #replaces = 0;

  constructor(
    readonly column: string,
    values: Readonly<Record<string, Uint8Array>>,
  ) {
    for (const [id, value] of Object.entries(values)) this.rows.set(id, value);
  }

  async page(afterId: string | undefined, limit: number): Promise<readonly EncryptedValue[]> {
    this.calls.push(`page ${this.column} after ${afterId ?? '-'}`);
    return [...this.rows.entries()]
      .filter(([id]) => afterId === undefined || id > afterId)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, limit)
      .map(([id, value]) => ({ id, value }));
  }

  async replace(id: string, stored: Uint8Array, next: Uint8Array): Promise<boolean> {
    this.#replaces += 1;
    if (this.#replaces === this.failOnReplace) throw new Error('worker stopped');
    const held = this.rows.get(id);
    if (held === undefined || !Buffer.from(held).equals(Buffer.from(stored))) return false;
    this.rows.set(id, next);
    return true;
  }

  /** Each row's plaintext and the key id it is stored under, as plain data. */
  read(): Record<string, { keyId: number | undefined; plaintext: string }> {
    return Object.fromEntries(
      [...this.rows.entries()].map(([id, value]) => [
        id,
        { keyId: value[0], plaintext: rotating.decrypt(value, this.column) },
      ]),
    );
  }
}

function underOldKey(column: string, count: number): Record<string, Uint8Array> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `row-${String(index).padStart(2, '0')}`,
      before.encrypt(`secret ${column} ${index}`, column),
    ]),
  );
}

function silentLog() {
  const lines: string[] = [];
  const fields: Record<string, unknown>[] = [];
  return {
    lines,
    fields,
    info: (logged: object, message: string) => {
      fields.push({ ...logged });
      lines.push(message);
    },
  };
}

function sweep(columns: readonly EncryptedColumn[], cipher = rotating, pageSize = 2) {
  const log = silentLog();
  const job = reencryptColumns({ cipher, columns, log, pageSize });
  return { job, log, run: () => job.handle({}) };
}

describe('the reencrypt-columns sweep (T155)', () => {
  it('is a sweep, so it runs on its own schedule with no payload', () => {
    const { job } = sweep([]);
    expect(job.name).toBe('reencrypt-columns');
    expect(job.schedule).toBeDefined();
  });

  it('reads nothing when no rotation is running', async () => {
    const column = new FakeColumn(MFA, underOldKey(MFA, 3));
    await sweep([column], after).run();
    expect(column.calls).toEqual([]);
  });

  it('writes every value under the old key again under the new one, its plaintext unchanged', async () => {
    const mfa = new FakeColumn(MFA, underOldKey(MFA, 5));
    const payout = new FakeColumn(PAYOUT, underOldKey(PAYOUT, 3));
    const plaintexts = [mfa.read(), payout.read()];

    await sweep([mfa, payout]).run();

    for (const column of [mfa, payout]) {
      for (const value of column.rows.values()) {
        expect(value[0]).toBe(columnKeyId(NEW_KEY));
        expect(() => before.decrypt(value, column.column)).toThrow();
      }
    }
    expect(Object.values(mfa.read()).map(({ plaintext }) => plaintext)).toEqual(
      Object.values(plaintexts[0] ?? {}).map(({ plaintext }) => plaintext),
    );
    expect(after.decrypt(payout.rows.get('row-02') ?? Buffer.alloc(0), PAYOUT)).toBe(
      `secret ${PAYOUT} 2`,
    );
  });

  it('leaves a value already under the new key as it is', async () => {
    const current = after.encrypt('already current', MFA);
    const column = new FakeColumn(MFA, { 'row-00': current, ...underOldKey(MFA, 0) });
    await sweep([column]).run();
    expect(column.rows.get('row-00')).toBe(current);
  });

  it('goes one column at a time, in pages, each after the last row of the one before', async () => {
    const mfa = new FakeColumn(MFA, underOldKey(MFA, 5));
    const payout = new FakeColumn(PAYOUT, underOldKey(PAYOUT, 2));
    const calls: string[] = [];
    const record = (column: FakeColumn): EncryptedColumn => ({
      column: column.column,
      page: async (afterId, limit) => {
        calls.push(`${column.column} after ${afterId ?? '-'} limit ${limit}`);
        return column.page(afterId, limit);
      },
      replace: (id, stored, next) => column.replace(id, stored, next),
    });

    await sweep([record(mfa), record(payout)]).run();

    expect(calls).toEqual([
      `${MFA} after - limit 2`,
      `${MFA} after row-01 limit 2`,
      `${MFA} after row-03 limit 2`,
      `${PAYOUT} after - limit 2`,
      `${PAYOUT} after row-01 limit 2`,
    ]);
  });

  it('is idempotent: two runs leave what one run leaves (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => [
        new FakeColumn(MFA, underOldKey(MFA, 3)),
        new FakeColumn(PAYOUT, underOldKey(PAYOUT, 2)),
      ],
      run: (columns) => sweep(columns).run(),
      observe: (columns) => columns.map((column) => column.read()),
    });
    expect(twice).toEqual(once);
  });

  it('resumes: a run stopped part way is finished by the next', async () => {
    const column = new FakeColumn(MFA, underOldKey(MFA, 5));
    column.failOnReplace = 3;

    await expect(sweep([column]).run()).rejects.toThrow('worker stopped');
    const keyIds = [...column.rows.values()].map((value) => value[0]);
    expect(keyIds.filter((id) => id === columnKeyId(OLD_KEY))).toHaveLength(3);

    await sweep([column]).run();
    for (const value of column.rows.values()) expect(value[0]).toBe(columnKeyId(NEW_KEY));
  });

  it('keeps a value the application wrote while the sweep held the old one', async () => {
    const column = new FakeColumn(MFA, underOldKey(MFA, 1));
    const written = after.encrypt('written meanwhile', MFA);
    const racing: EncryptedColumn = {
      column: MFA,
      page: (afterId, limit) => column.page(afterId, limit),
      replace: async (id, stored, next) => {
        column.rows.set(id, written);
        return column.replace(id, stored, next);
      },
    };

    await sweep([racing]).run();
    expect(column.rows.get('row-00')).toBe(written);
  });

  it('writes every value it can read and then fails, naming each column and its count only', async () => {
    const lost = new ColumnCipher(LOST_KEY).encrypt('nobody holds this key', MFA);
    const mfa = new FakeColumn(MFA, { ...underOldKey(MFA, 2), 'row-09': lost });
    const payout = new FakeColumn(PAYOUT, underOldKey(PAYOUT, 2));
    const { log, run } = sweep([mfa, payout]);

    const failure = await run().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(UnreadableValuesError);
    const message = String((failure as Error).message);
    expect(message).toContain(`${MFA}: 1`);
    expect(message).not.toContain('row-09');
    expect(message).not.toContain(Buffer.from(lost).toString('hex'));
    expect(mfa.rows.get('row-00')?.[0]).toBe(columnKeyId(NEW_KEY));
    expect(payout.rows.get('row-01')?.[0]).toBe(columnKeyId(NEW_KEY));
    expect(mfa.rows.get('row-09')).toBe(lost);
    expect(log.lines).toEqual([]);
  });

  it('counts a value that names the new key’s id but neither key reads (PR #61 review, n1)', async () => {
    const shared = Array.from({ length: 4096 }, (_, counter) => {
      const key = Buffer.alloc(32);
      key.writeUInt32BE(counter + 1);
      return key.toString('base64');
    }).find((key) => key !== NEW_KEY && columnKeyId(key) === columnKeyId(NEW_KEY));
    const impostor = new ColumnCipher(shared ?? NEW_KEY).encrypt('nobody holds this key', MFA);
    const column = new FakeColumn(MFA, { ...underOldKey(MFA, 1), 'row-09': impostor });
    const { log, run } = sweep([column]);

    expect(impostor[0]).toBe(columnKeyId(NEW_KEY));
    await expect(run()).rejects.toThrow(`${MFA}: 1`);
    expect(column.rows.get('row-00')?.[0]).toBe(columnKeyId(NEW_KEY));
    expect(log.lines).toEqual([]);
  });

  it('says the previous key can be removed only after a run that left none of its values', async () => {
    const column = new FakeColumn(MFA, underOldKey(MFA, 3));
    const { log, run } = sweep([column]);
    await run();
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatch(/ENCRYPTION_KEY_PREVIOUS can be removed/);
  });

  it('names when the run that left none started, so a line is matched to a restart (n3)', async () => {
    const before = Date.now();
    const { log, run } = sweep([new FakeColumn(MFA, underOldKey(MFA, 1))]);
    await run();
    const startedAt = Date.parse(String(log.fields[0]?.['startedAt']));
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(Date.now());
  });
});
