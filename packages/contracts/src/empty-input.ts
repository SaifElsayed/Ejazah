// T099: the input of a mutation that takes nothing. tRPC 11.19's client sends a mutation whose input
// is `undefined` with no body, and its server cannot read a mutation without one (it answers 500
// before the procedure runs), so such a mutation takes this empty object and its client sends `{}`.
// Strict, so the empty object stays empty. The administrator surface exports it apart, as
// `adminEmptyInput` (R-API-11).
import { z } from 'zod';

export const emptyInput = z.object({}).strict();

export type EmptyInput = z.infer<typeof emptyInput>;
