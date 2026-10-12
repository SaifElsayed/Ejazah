// T163 fixture: a file under a covered path whose spec exercises one branch of four, so the
// coverage floor of packages/config/vitest.base.ts (80%, T086) must refuse the run (R-PROC-5).
// Never collected by the repository's own run: tests/violations/fixtures/** is excluded there.
export function sign(value: number): string {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  if (Number.isNaN(value)) return 'not a number';
  return 'zero';
}

export function untested(value: number): number {
  const doubled = value * 2;
  const shifted = doubled + 3;
  return shifted;
}
