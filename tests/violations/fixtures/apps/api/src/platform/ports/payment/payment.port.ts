// T020 fixture support — the port. This is the only name a module outside the folder may know.
export interface PaymentPort {
  createCheckout(orderReference: string): Promise<string>;
}
