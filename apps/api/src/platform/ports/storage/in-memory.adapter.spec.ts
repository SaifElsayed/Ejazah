// T122: the storage stand-in records what it was asked and fails an operation when told. Its storage
// contract is T115's, run against it in `storage.spec.ts` beside the two real implementations.
import { describe, expect, it } from 'vitest';
import { StandInFailure } from '../stand-in.js';
import { InMemoryStorageAdapter } from './in-memory.adapter.js';

const body = new TextEncoder().encode('%PDF-1.7 certificate');

describe('the storage stand-in: records and induced failure (T122)', () => {
  it('records every operation it was asked to do, with its arguments', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.put('certificates/a.pdf', body, 'application/pdf');
    await storage.exists('certificates/a.pdf');
    await storage.temporaryLink('certificates/a.pdf', 600);
    await storage.remove('certificates/a.pdf');

    expect(storage.calls).toEqual([
      { operation: 'put', args: ['certificates/a.pdf', body, 'application/pdf'] },
      { operation: 'exists', args: ['certificates/a.pdf'] },
      { operation: 'temporaryLink', args: ['certificates/a.pdf', 600] },
      { operation: 'remove', args: ['certificates/a.pdf'] },
    ]);
  });

  it('keeps what was put, with its declared content type, for a test to read', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.put('certificates/a.pdf', body, 'application/pdf');

    expect(storage.stored('certificates/a.pdf')).toEqual({ body, contentType: 'application/pdf' });
    expect(storage.stored('certificates/b.pdf')).toBeUndefined();
  });

  it('fails a put when told, storing nothing', async () => {
    const storage = new InMemoryStorageAdapter();
    storage.failNext('put');

    await expect(storage.put('certificates/a.pdf', body, 'application/pdf')).rejects.toThrow(
      StandInFailure,
    );
    expect(await storage.exists('certificates/a.pdf')).toBe(false);
  });

  it('fails a removal when told, keeping the object', async () => {
    const storage = new InMemoryStorageAdapter();
    await storage.put('certificates/a.pdf', body, 'application/pdf');
    storage.failNext('remove', new Error('bucket unreachable'));

    await expect(storage.remove('certificates/a.pdf')).rejects.toThrow('bucket unreachable');
    expect(await storage.exists('certificates/a.pdf')).toBe(true);
  });

  it.each(['temporaryLink', 'exists'] as const)('fails %s when told', async (operation) => {
    const storage = new InMemoryStorageAdapter();
    storage.failNext(operation);

    const call =
      operation === 'temporaryLink'
        ? storage.temporaryLink('certificates/a.pdf', 60)
        : storage.exists('certificates/a.pdf');

    await expect(call).rejects.toThrow(StandInFailure);
  });

  it('refuses a link from another instance, or one altered after it was issued', async () => {
    const storage = new InMemoryStorageAdapter();
    const link = await storage.temporaryLink('certificates/a.pdf', 600);
    const elsewhere = await new InMemoryStorageAdapter().temporaryLink('certificates/a.pdf', 600);

    expect(storage.verifyLink(link)).toBe('certificates/a.pdf');
    expect(storage.verifyLink(elsewhere)).toBeUndefined();
    expect(
      storage.verifyLink(link.replace('certificates/a.pdf', 'certificates/b.pdf')),
    ).toBeUndefined();
  });
});
