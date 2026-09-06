# Flows

Multi-frame walkthroughs, one file per flow: onboarding, booking-and-payment,
granting-an-ijazah, reporting. A flow shows the frames in order with the
decision points between them, so a reviewer can see the path rather than the
screens.

The booking-and-payment flow shows five states in order: Checkout → gateway
hosted checkout → Processing → Payment successful (or Payment not completed),
with the delayed-confirmation branch off Processing (ADR 0008 D1). There is no
"waiting for the gateway" screen: success is rendered from server state the
moment the enrollment is confirmed.
