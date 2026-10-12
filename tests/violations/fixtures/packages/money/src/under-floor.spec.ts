// T163 fixture: one passing test, which leaves under-floor.ts below the coverage floor, so the
// run fails on the floor alone (tests/pipeline/suite-gate.spec.ts).
import { expect, it } from 'vitest';
import { sign } from './under-floor';

it('names a positive number', () => {
  expect(sign(1)).toBe('positive');
});
