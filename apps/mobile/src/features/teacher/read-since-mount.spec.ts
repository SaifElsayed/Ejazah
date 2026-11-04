// T051 (the owner's decision of 2026-11-04 for B31; T086's bug): a screen decides only on what it
// read since it opened. React Query sets `isFetchedAfterMount` after a failed read too, so the
// cached answer of an earlier visit is never taken for this one's.
import { describe, expect, it } from '@jest/globals';

import { readSinceMount } from './read-since-mount';

const CACHED = { items: ['earlier'] };

describe('readSinceMount', () => {
  it('waits, with the cached answer, while the read made on opening has not come back', () => {
    expect(readSinceMount({ data: CACHED, isError: false, isFetchedAfterMount: false })).toEqual({
      state: 'waiting',
      cached: CACHED,
    });
    expect(readSinceMount({ data: undefined, isError: false, isFetchedAfterMount: false })).toEqual(
      { state: 'waiting', cached: undefined },
    );
  });

  it('says failed when the read made on opening failed, though an earlier answer is cached', () => {
    expect(readSinceMount({ data: CACHED, isError: true, isFetchedAfterMount: true })).toEqual({
      state: 'failed',
    });
  });

  it('keeps waiting on an error cached before it opened while its own read is on the way', () => {
    expect(readSinceMount({ data: CACHED, isError: true, isFetchedAfterMount: false })).toEqual({
      state: 'waiting',
      cached: CACHED,
    });
  });

  it('decides on an answer read since it opened', () => {
    const fresh = { items: ['now'] };
    expect(readSinceMount({ data: fresh, isError: false, isFetchedAfterMount: true })).toEqual({
      state: 'read',
      data: fresh,
    });
  });
});
