// T093 — the `purge-unreferenced-documents` sweep (PR #80 review, finding 9; owner's decision
// 2026-10-19; R-API-14).
//
// A document is uploaded before the submission that points at it (`teacher.application.submit`,
// `teacher.credentials.add`, `account.identityVerification.submit`), so an upload nobody submits
// would stay in storage for ever. The sweep deletes every document uploaded longer ago than
// `document_unreferenced_purge_after_hours` that no row points at, and its object, through the
// verification module's store, reading the window on every run (FR-034). The store answers each
// candidate with its storage key decrypted and removes the row only while nothing points at it,
// the object inside that removal, so a document pointed at in between is kept whole. Its
// double-run assertion calls the handler directly over an in-memory store: two runs leave what one
// run leaves.
import { describe, expect, it } from 'vitest';

import { SettingError, type SettingsReader } from '../platform/settings/settings-reader.js';
import { runOnceAndTwice } from './double-run.js';
import {
  DOCUMENT_UNREFERENCED_PURGE_AFTER_HOURS_SETTING,
  purgeUnreferencedDocuments,
  type UnreferencedDocumentStore,
} from './purge-unreferenced-documents.js';

const NOW = new Date('2026-10-20T09:00:00Z');

interface Row {
  readonly id: string;
  readonly uploadedAt: Date;
  /** Whether a row of any module points at it. */
  referenced: boolean;
}

function row(id: string, uploadedAt: string, referenced = false): Row {
  return { id, uploadedAt: new Date(uploadedAt), referenced };
}

function storeOf(rows: readonly Row[]) {
  const objects = new Set(rows.map(({ id }) => `documents/${id}.pdf`));
  const store: UnreferencedDocumentStore & { rows: Row[] } = {
    rows: [...rows],
    async listUnreferencedUploadedBefore(uploadedBefore) {
      return this.rows
        .filter(({ referenced, uploadedAt }) => !referenced && uploadedAt < uploadedBefore)
        .map(({ id }) => ({ id, storageKey: `documents/${id}.pdf` }));
    },
    async removeUnreferenced({ id, storageKey }, removeObject) {
      const found = this.rows.find((each) => each.id === id);
      if (found === undefined || found.referenced) return false;
      await removeObject(storageKey);
      this.rows = this.rows.filter((each) => each.id !== id);
      return true;
    },
  };
  const storage = {
    removed: [] as string[],
    async remove(key: string) {
      this.removed.push(key);
      objects.delete(key);
    },
  };
  return { store, storage, objects };
}

function settingsOf(hours: unknown): SettingsReader & { keys: string[] } {
  return {
    keys: [],
    async read(key, schema) {
      this.keys.push(key);
      if (key !== DOCUMENT_UNREFERENCED_PURGE_AFTER_HOURS_SETTING) {
        throw new SettingError(key, 'missing');
      }
      const parsed = schema.safeParse(hours);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
}

function world() {
  const { store, storage, objects } = storeOf([
    row('old-unreferenced', '2026-10-17T08:59:59Z'),
    row('old-referenced', '2026-10-17T08:00:00Z', true),
    row('at-the-window', '2026-10-17T09:00:00Z'),
    row('recent', '2026-10-20T08:00:00Z'),
  ]);
  const settings = settingsOf(72);
  const job = purgeUnreferencedDocuments({ store, storage, settings, clock: () => NOW });
  return { store, storage, objects, settings, job };
}

describe('purge-unreferenced-documents (T093)', () => {
  it('deletes each document older than the window that nothing points at, and its object', async () => {
    const { store, storage, objects, job } = world();
    await job.handle({});
    expect(store.rows.map(({ id }) => id)).toEqual(['old-referenced', 'at-the-window', 'recent']);
    expect(storage.removed).toEqual(['documents/old-unreferenced.pdf']);
    expect(objects.has('documents/old-unreferenced.pdf')).toBe(false);
  });

  it('keeps a document pointed at after it was listed, and its object', async () => {
    const { store, storage, job } = world();
    const listed = store.listUnreferencedUploadedBefore.bind(store);
    store.listUnreferencedUploadedBefore = async (before) => {
      const candidates = await listed(before);
      for (const each of store.rows) each.referenced = true;
      return candidates;
    };
    await job.handle({});
    expect(store.rows).toHaveLength(4);
    expect(storage.removed).toEqual([]);
  });

  it('reads its window through the settings reader on every run, and fails closed without it', async () => {
    const { settings, job } = world();
    await job.handle({});
    await job.handle({});
    expect(settings.keys).toEqual([
      DOCUMENT_UNREFERENCED_PURGE_AFTER_HOURS_SETTING,
      DOCUMENT_UNREFERENCED_PURGE_AFTER_HOURS_SETTING,
    ]);
    for (const hours of [undefined, 0]) {
      const { store, storage } = storeOf([row('old', '2026-10-01T00:00:00Z')]);
      const job = purgeUnreferencedDocuments({
        store,
        storage,
        settings: settingsOf(hours),
        clock: () => NOW,
      });
      await expect(job.handle({})).rejects.toBeInstanceOf(SettingError);
      expect(store.rows).toHaveLength(1);
    }
  });

  it('runs on a schedule, with no payload', () => {
    const { job } = world();
    expect(job.name).toBe('purge-unreferenced-documents');
    expect(job.schedule).toEqual(expect.any(String));
  });

  it('leaves after two runs what it leaves after one (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world,
      run: async ({ job }) => job.handle({}),
      observe: ({ store, objects }) => ({
        rows: store.rows.map(({ id }) => id),
        objects: [...objects].sort(),
      }),
    });
    expect(once).toEqual({
      rows: ['old-referenced', 'at-the-window', 'recent'],
      objects: [
        'documents/at-the-window.pdf',
        'documents/old-referenced.pdf',
        'documents/recent.pdf',
      ],
    });
    expect(twice).toEqual(once);
  });
});
