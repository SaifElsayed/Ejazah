// T087 — `scripts/dev/local-only.ts`, the one guard of quickstart's three dev scripts (note under
// T087, the owner's approval of 2026-10-27): they run only where `NODE_ENV` is development or test
// and the database and the API are on this machine, the conditions of `emit-recipient-event.ts`
// (the owner's condition 3 at B15), which keeps its own copy. A refusal names the key, never its
// value. The read-only connection the two readers use is refused a write by the database itself.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiOriginOf,
  connectReadOnly,
  type Connection,
  localOnlyRefusal,
} from '../../scripts/dev/local-only';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';

const LOCAL = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://ijazah_app:secret@localhost:5432/ijazah',
};
const API = 'http://localhost:3000';

describe('the guard (note under T087)', () => {
  it('runs on a development or test machine whose database and API are both local', () => {
    expect(localOnlyRefusal(LOCAL)).toBeNull();
    expect(localOnlyRefusal(LOCAL, API)).toBeNull();
    expect(localOnlyRefusal({ ...LOCAL, NODE_ENV: 'test' }, API)).toBeNull();
    expect(
      localOnlyRefusal(
        { ...LOCAL, DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/ijazah' },
        'https://127.0.0.1:3000',
      ),
    ).toBeNull();
    expect(
      localOnlyRefusal(
        { ...LOCAL, DATABASE_URL: 'postgresql://u:p@[::1]:5432/ijazah' },
        'http://[::1]:3000',
      ),
    ).toBeNull();
  });

  it('refuses unless NODE_ENV is development or test', () => {
    for (const NODE_ENV of ['production', 'staging', 'Development', '', undefined]) {
      expect(localOnlyRefusal({ ...LOCAL, NODE_ENV })).toMatch(/NODE_ENV/);
    }
  });

  it('refuses a database that is not on this machine, however its address is written', () => {
    for (const DATABASE_URL of [
      'postgresql://u:p@db.example.com:5432/ijazah',
      'postgresql://u:p@10.0.0.5:5432/ijazah',
      'postgresql://u:p@localhost.example.com/ijazah',
      'postgresql://u:p@localhost/ijazah?host=db.example.com',
      'postgresql://u:p@localhost/ijazah?hostaddr=10.0.0.5',
      'mysql://u:p@localhost/ijazah',
      'postgresql:///ijazah',
      'not a url',
      '',
      undefined,
    ]) {
      expect(localOnlyRefusal({ ...LOCAL, DATABASE_URL })).toMatch(/DATABASE_URL/);
    }
  });

  it('refuses an API that is not on this machine', () => {
    for (const api of [
      'https://api.ijazah.example',
      'http://192.168.1.20:3000',
      'http://localhost.evil.example',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(localOnlyRefusal(LOCAL, api)).toMatch(/API/);
    }
  });

  it('names the key and never the value it refused', () => {
    const secret = 'postgresql://owner:s3cr3t-value@db.example.com:5432/ijazah';
    const refusal = localOnlyRefusal({ ...LOCAL, DATABASE_URL: secret }) ?? '';
    expect(refusal).toMatch(/DATABASE_URL/);
    expect(refusal).not.toContain('s3cr3t-value');
    expect(refusal).not.toContain('db.example.com');
    expect(localOnlyRefusal({ ...LOCAL, NODE_ENV: 'production' })).not.toContain('production');
    expect(localOnlyRefusal(LOCAL, 'https://api.ijazah.example')).not.toContain('ijazah.example');
  });
});

describe('the API origin', () => {
  it('is the one given, or localhost on PORT, or on the API’s default port', () => {
    expect(apiOriginOf({ PORT: '4000' }, 'http://127.0.0.1:5000')).toBe('http://127.0.0.1:5000');
    expect(apiOriginOf({ PORT: '4000' })).toBe('http://localhost:4000');
    expect(apiOriginOf({})).toBe('http://localhost:3000');
    expect(apiOriginOf({ PORT: '' })).toBe('http://localhost:3000');
  });
});

// T124: skipped unless IJAZAH_DB_SPECS=1, the URL from the environment only (PR #112's review, round 1).
describe('the read-only connection', { tags: ['database'] }, () => {
  let db: Connection;
  beforeAll(async () => {
    db = await connectReadOnly(specDatabaseUrl('DATABASE_URL'));
  });
  afterAll(async () => {
    await db.end();
  });

  it('reads, and the database refuses it any write (SQLSTATE 25006)', async () => {
    const { rows } = await db.query<{ one: number }>('SELECT 1 AS one');
    expect(rows).toEqual([{ one: 1 }]);
    await expect(
      db.query('UPDATE settings SET updated_at = updated_at WHERE false'),
    ).rejects.toMatchObject({ code: '25006' });
  });
});
