// T048: the user surface's services for a spec that reaches only some of them. A member a spec does
// not hand in answers every call by throwing, so a procedure reaching a service its spec did not
// expect fails loudly instead of answering from a stand-in nobody wrote.
import type { IdentityServices } from '../modules/identity/index.js';

function unreached(name: string): never {
  throw new Error(`${name}: not reached by this spec`);
}

const handler: ProxyHandler<object> = {
  get: (_target, service) =>
    new Proxy(
      {},
      { get: (_inner, method) => () => unreached(`identity.${String(service)}.${String(method)}`) },
    ),
};

/** The identity module's services, none of which the spec calls. */
export const unusedIdentityServices = new Proxy({}, handler) as IdentityServices;
