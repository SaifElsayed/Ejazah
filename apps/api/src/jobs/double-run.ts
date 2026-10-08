// T112: the double-run assertion pattern every job's spec uses (R-API-14, FR-052).
//
// A job is idempotent when running it twice leaves the world it leaves after one run. The pattern
// reads that directly: a fresh world run once, a second fresh world run twice, both read the same
// way. The spec then asserts `expect(twice).toEqual(once)`, so the assertion is the spec's own and
// this file depends on no test runner. Each reading gets its own world, so nothing the first run
// left can make the second look idempotent.

export interface DoubleRun<TWorld> {
  /** A fresh world, built the same way each time it is called. */
  readonly world: () => TWorld | Promise<TWorld>;
  /** One delivery of the job, its handler called directly (no queue). */
  readonly run: (world: TWorld) => Promise<void>;
  /** What the job left behind, as plain data to compare. */
  readonly observe: (world: TWorld) => unknown;
}

export interface DoubleRunReading {
  readonly once: unknown;
  readonly twice: unknown;
}

export async function runOnceAndTwice<TWorld>({
  world,
  run,
  observe,
}: DoubleRun<TWorld>): Promise<DoubleRunReading> {
  const single = await world();
  await run(single);
  const once = await observe(single);

  const double = await world();
  await run(double);
  await run(double);
  const twice = await observe(double);

  return { once, twice };
}
