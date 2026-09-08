// T020 fixture — VIOLATION of R-API-4, adapter half: a module names a concrete implementation
// instead of the port. The domain never knows a vendor's name; selection is configuration.
// Refused by boundaries/no-adapter-import.
import { FakePaymentAdapter } from '../../platform/ports/payment/fake.adapter';

export function checkoutClient(): FakePaymentAdapter {
  return new FakePaymentAdapter();
}
