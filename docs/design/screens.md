# Screen inventory

Each frame below maps to a route under `apps/mobile/src/app/`. The `.dc.html`
files in `frames/` are the visual source; the route is the implementation.

## Auth — `(auth)`
| Frame | Route | Notes |
|---|---|---|
| Welcome | `(auth)/index` | Language, why an account is needed, then Continue with Google, Continue with Apple (iOS only) and Continue with email (ADR 0012) |
| Email sign-in | `(auth)/email` | Email and password; forgot password |
| Email sign-up | `(auth)/email-sign-up` | Email and password, then the code |
| Email code | `(auth)/verify` | Six digits sent to the email, auto-advance, resend timer |
| Reset password | `(auth)/reset` | Code to the verified email, new password; email accounts only |
| Role | `(auth)/role` | First sign-in only: student, teacher or both (FR-AUTH-2, FR-AUTH-12) |
| Profile | `(auth)/profile` | Display name (prefilled from Google or Apple), gender, date of birth, time zone, Terms |
| Confirm gender | sheet | Gender shown back before the account is completed; only an admin can change it later (FR-GENDER-5) |

## Student — `(student)`, frames in `Ijazah Student Screens.dc.html`
| Frame | Route | Notes |
|---|---|---|
| Home | `(student)/index` | Next session, current enrollment progress |
| Discovery | `(student)/discovery` | Filters: riwayah, gender, time of day, price |
| Teacher profile | `(student)/discovery` detail | Isnad shown as a chain, gold accent |
| Booking sheet | overlay | Slot pick with a quiet hold countdown; continues to Checkout (FR-BOOK-9) |
| Checkout | `(student)/checkout` | Order summary — teacher, package, subject, weekly slot in the student's zone, session count, total — payment method where the gateway offers it in-app, one primary Pay action. Pay creates the enrollment as pending and the gateway order (FR-PAYG-2) |
| Gateway checkout | in-app secure browser sheet | The gateway's hosted page. Card details are entered there and never in the app |
| Processing | `(student)/checkout/processing` | One full-screen state, "Confirming your payment", while the app subscribes to the enrollment's server-side status (FR-PAYG-17). Typically under three seconds. Past the confirmation timeout (§3.14) it becomes "Payment received, finalising your sessions" and releases the student to the app with a "Confirming" badge on the enrollment (FR-PAYG-18) |
| Payment successful | `(student)/checkout/confirmed` | Rendered only when the server reports `confirmed` (R-HONEST-1): receipt (order reference, amount paid, date), the generated sessions with the first date and time, primary action to the enrollment |
| Payment not completed | `(student)/checkout/failed` | Gateway reported failed or cancelled, or the student backed out. The hold stays. Retry (new order on the same hold, while orders can still be created on it, FR-PAYG-18) or Choose another slot (FR-BOOK-12): immediate when no order on the hold is still payable (`created`), as after a failure; otherwise only once the gateway has cancelled that order. Where the gateway reports the earlier payment went through or is still being processed, the new checkout is refused and the student is taken to that enrollment's Processing screen; where the gateway cannot cancel, the student is offered to continue the previous payment with the time left on it (ADR 0010 D6) |
| Enrollments | `(student)/enrollments` | Sessions consumed vs total |
| Credentials | `(student)/credentials` | Granted ijazah, certificate, verify code |
| Account | `(student)/account` | Locale, notifications |

## Teacher — `(teacher)`, frames in `Ijazah Teacher Screens v2.dc.html`
| Frame | Route | Notes |
|---|---|---|
| Home | `(teacher)/index` | The day at a glance, dense by design |
| Availability | `(teacher)/availability` | Weekly rules, authored in the teacher zone |
| Packages | `(teacher)/packages` | Draft, published, archived |
| Isnad | application flow | Chain entry and document upload |
| Granting | `(teacher)/granting` | Propose, then confirm an ijazah grant |
| Payout setup | `(teacher)/payout-setup` | Shown right after approval; registers a payout account with the gateway and shows pending / verified / rejected. No balance, ever (FR-PAYG-13/15) |
| Account | `(teacher)/account` | |

## Shared
| Frame | Route | Notes |
|---|---|---|
| Session room | `session/[id]` | Outside the role groups; both roles enter it |
| Chat | shared feature | Retention notice is part of the empty state |
| Notifications | shared feature | Quiet hours respected |

## Tab bars
`TeacherTabs.dc.html` and `StudentTabs.dc.html` are the two tab bars. They are
different by intent — the student bar guides, the teacher bar navigates.

`ios-frame.jsx` is the device chrome the frames are drawn inside; it is a design
asset, not app code. `flows/` holds multi-frame walkthroughs (onboarding,
booking, granting).
