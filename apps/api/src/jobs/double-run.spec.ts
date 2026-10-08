// T112 — the double-run assertion pattern (R-API-14, FR-052).
//
// Every job's own spec proves that two runs leave what one run leaves. The pattern does it the same
// way each time: build a fresh world, run the job once and read what it left; build a second
// fresh world, run the job twice and read again; the two readings must be equal. These cases prove
// the pattern itself can tell the difference: a job that only sets state passes, and a job that
// adds on every run is caught.
import { describe, expect, it } from 'vitest';
import { runOnceAndTwice } from './double-run.js';

interface World {
  readonly rows: Map<string, string>;
  readonly sent: string[];
}

const freshWorld = (): World => ({ rows: new Map([['hold-1', 'active']]), sent: [] });
const observe = (world: World) => ({ rows: [...world.rows], sent: [...world.sent] });

describe('runOnceAndTwice (T112)', () => {
  it('reads the same world after one run and after two of an idempotent job', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: freshWorld,
      run: async (world) => {
        if (world.rows.get('hold-1') !== 'active') return;
        world.rows.set('hold-1', 'released');
        world.sent.push('hold released');
      },
      observe,
    });
    expect(once).toEqual({ rows: [['hold-1', 'released']], sent: ['hold released'] });
    expect(twice).toEqual(once);
  });

  it('shows a job that repeats its effect as two different worlds', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: freshWorld,
      run: async (world) => {
        world.rows.set('hold-1', 'released');
        world.sent.push('hold released');
      },
      observe,
    });
    expect(twice).not.toEqual(once);
  });

  it('builds a separate world for each reading, so the first run cannot leak into the second', async () => {
    const worlds: World[] = [];
    await runOnceAndTwice({
      world: () => {
        const world = freshWorld();
        worlds.push(world);
        return world;
      },
      run: async () => {},
      observe,
    });
    expect(worlds).toHaveLength(2);
    expect(worlds[0]).not.toBe(worlds[1]);
  });
});
