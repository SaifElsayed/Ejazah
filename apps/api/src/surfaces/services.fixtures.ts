// T048: the user surface's services for a spec that reaches only some of them. A member a spec does
// not hand in answers every call by throwing, so a procedure reaching a service its spec did not
// expect fails loudly instead of answering from a stand-in nobody wrote. T056 adds the
// verification module's.
import type { IdentityServices } from '../modules/identity/index.js';
import type { VerificationServices } from '../modules/verification/index.js';

function unreached(name: string): never {
  throw new Error(`${name}: not reached by this spec`);
}

function unused(module: string): ProxyHandler<object> {
  return {
    get: (_target, service) =>
      new Proxy(
        {},
        {
          get: (_inner, method) => () =>
            unreached(`${module}.${String(service)}.${String(method)}`),
        },
      ),
  };
}

/** The identity module's services, none of which the spec calls. */
export const unusedIdentityServices = new Proxy({}, unused('identity')) as IdentityServices;

/** The verification module's services, none of which the spec calls. */
export const unusedVerificationServices = new Proxy(
  {},
  unused('verification'),
) as VerificationServices;
