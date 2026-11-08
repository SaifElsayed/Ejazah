// T048: the user surface's services for a spec that reaches only some of them. A member a spec does
// not hand in answers every call by throwing, so a procedure reaching a service its spec did not
// expect fails loudly instead of answering from a stand-in nobody wrote. T056 adds the
// verification module's, T067 the administrator surface's, T020 the catalog module's, T026 the
// booking module's discovery, T032 its `booking` namespace, T036 the payments module's `checkout`,
// T011 of specs/004-sessions the sessions module's `sessions`.
import type { BookingServices, DiscoveryServices } from '../modules/booking/index.js';
import type { CatalogServices } from '../modules/catalog/index.js';
import type { IdentityServices } from '../modules/identity/index.js';
import type { TeacherProfileServices } from '../modules/identity/index.js';
import type { CheckoutServices } from '../modules/payments/index.js';
import type { SessionsServices } from '../modules/sessions/index.js';
import type { VerificationServices } from '../modules/verification/index.js';
import type { AdminSurfaceServices } from './context.js';

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

/** The catalog module's services, none of which the spec calls (T020). */
export const unusedCatalogServices = new Proxy({}, unused('catalog')) as CatalogServices;

/** The teacher's profile service, whose methods the spec never calls (T017). */
export const unusedTeacherProfileServices = new Proxy(
  {},
  { get: (_target, method) => () => unreached(`teacherProfile.${String(method)}`) },
) as TeacherProfileServices;

/** The verification module's services, none of which the spec calls. */
export const unusedVerificationServices = new Proxy(
  {},
  unused('verification'),
) as VerificationServices;

/** The administrator surface's services, none of which the spec calls. */
export const unusedAdminServices = new Proxy({}, unused('admin')) as AdminSurfaceServices;

/** The `discovery` procedures' services, whose methods the spec never calls (T026). */
export const unusedDiscoveryServices = new Proxy(
  {},
  { get: (_target, method) => () => unreached(`discovery.${String(method)}`) },
) as DiscoveryServices;

/** The `booking` procedures' services, whose methods the spec never calls (T032). */
export const unusedBookingServices = new Proxy(
  {},
  { get: (_target, method) => () => unreached(`booking.${String(method)}`) },
) as BookingServices;

/** The `checkout` procedures' services, whose methods the spec never calls (T036). */
export const unusedCheckoutServices = new Proxy(
  {},
  { get: (_target, method) => () => unreached(`checkout.${String(method)}`) },
) as CheckoutServices;

/** The `sessions` procedures' services, whose methods the spec never calls (T011 of specs/004-sessions). */
export const unusedSessionsServices = new Proxy(
  {},
  { get: (_target, method) => () => unreached(`sessions.${String(method)}`) },
) as SessionsServices;
