// T020 fixture support — a concrete implementation. It never leaves its own port folder (R-API-4).
import type { PaymentPort } from './payment.port';

export class FakePaymentAdapter implements PaymentPort {
  async createCheckout(orderReference: string): Promise<string> {
    return orderReference;
  }
}
