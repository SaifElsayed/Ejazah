// T099: the administrator surface's input of a mutation that takes nothing, the user surface's
// empty object exported under this surface's own name (R-API-11): tRPC 11.19's client sends a
// mutation whose input is `undefined` with no body, which its server cannot read.
export { emptyInput as adminEmptyInput } from '../empty-input.js';
