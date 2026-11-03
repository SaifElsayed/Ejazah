// PUBLIC ENTRY of the booking module (T017). Other modules import this file and nothing below it (R-API-3).
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CatalogUse } from '../catalog/index.js';
import { packageEnrollmentCounts, packageHasEnrollment } from './catalog-use.repository.js';
import {
  type DiscoveryCatalog,
  DiscoveryService,
  type DiscoveryServices,
} from './discovery.service.js';
import { createNearestSlots } from './nearest-slot.service.js';
import {
  SLOT_RELEASE_BUFFER_SETTING,
  slotInUse,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';

/**
 * What catalog's `CatalogUse` port asks of booking (T020, R-207), on the caller's transaction:
 * whether a slot is in use and whether a package has an enrollment. `slotInUse` takes R-205's
 * release since T026: the clock, and the buffer when a confirmed enrollment needs it.
 */
export { packageHasEnrollment } from './catalog-use.repository.js';
export { type SlotRelease, slotInUse } from './slot-occupancy.service.js';
/** Each of a teacher's packages' enrollments, for catalog's list (T018). */
export { packageEnrollmentCounts } from './catalog-use.repository.js';
/** The `order_failed` outcome the payments module's order branch appends (T038, R-214). */
export { recordOrderFailed } from './order-failed.repository.js';

/**
 * Catalog's `CatalogUse` port over booking's answers (T020, T026), bound once by `main.ts`: a slot's
 * release reads the clock, and `slot_release_buffer_weeks` when it needs it.
 */
export function createCatalogUse({
  settings,
  now = () => new Date(),
}: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): CatalogUse {
  const release = {
    now,
    bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
  };
  return {
    slotInUse: (tx, slotId) => slotInUse(tx, slotId, release),
    packageHasEnrollment,
    packageEnrollmentCounts,
  };
}

/**
 * Booking's reads for discovery (T026, R-205): the nearest free slot of each teacher of a page, on
 * the caller's transaction, exported for the probe of its queries
 * (`tests/db-integrity/discovery-slots.spec.ts`).
 */
export { type NearestSlot, nearestFreeSlots } from './nearest-slot.service.js';

/** The `booking` namespace, mounted by `app.router.ts` (T032). */
export { bookingRouter } from './booking.router.js';
/**
 * `booking.slots`' services over the process's client (T032), and its read on the caller's
 * transaction over the owners' entries, exported for the probe of its queries
 * (`tests/db-integrity/booking-slots.spec.ts`).
 */
export {
  type BookingServices,
  type BookingStudent,
  bookingSlotsOf,
  bookingSlotsStore,
  createBookingServices,
} from './booking-slots.service.js';

/** The `discovery` namespace, mounted by `app.router.ts` (T026). */
export { discoveryRouter } from './discovery.router.js';
export type {
  CatalogDiscoveryCard,
  CatalogDiscoveryPage,
  DiscoveryCatalog,
  DiscoveryServices,
} from './discovery.service.js';

/**
 * The `discovery` procedures' services (T026): catalog's discovery service through the seam, and
 * booking's nearest slots over the process's client.
 */
export function createDiscoveryServices({
  catalog,
  database,
  settings,
  now,
}: {
  readonly catalog: DiscoveryCatalog;
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): DiscoveryServices {
  return new DiscoveryService({
    catalog,
    nearest: createNearestSlots({ database, settings, ...(now === undefined ? {} : { now }) }),
  });
}

/**
 * Holds (T033, FR-351 to FR-353, FR-363, FR-PAYG-19, R-208), each on the caller's transaction:
 * placing one (`checkout.hold`, T036), releasing holds with their reason (FR-BOOK-12's new checkout,
 * T036; the sweeps, T040; the terminations, T041), releasing a slot's and a student's expired holds,
 * and FR-PAYG-19's re-hold of a paid enrollment (T039). The orders' standing is payments'
 * `orderStandingsOf`, handed in by the caller (R-208). `readHoldTerms` reads the hold's settings
 * before the caller's transaction; `holdsStore` is the placement's store over the owners' entries,
 * exported for the probes (`tests/db-integrity/hold-concurrency.spec.ts`).
 */
export {
  type EnrollmentToHold,
  type HoldRequest,
  type HoldScope,
  type HoldsStore,
  holdsStore,
  type HoldStudent,
  type HoldTerms,
  type OrderStanding,
  type OrderStandings,
  type PlacedHold,
  placeHold,
  readHoldTerms,
  type ReleasedHolds,
  type ReleaseReason,
  releaseExpiredHolds,
  releaseHolds,
  reholdEnrollment,
} from './holds.service.js';
/**
 * Booking's one writer of `enrollment_events` rows (T033, R-216, FR-385), on the caller's transaction
 * holding the enrollment's lock (and the payment's when the row names one).
 */
export {
  type EnrollmentCancellationReason,
  type EnrollmentOutcome,
  recordEnrollmentEvents,
} from './enrollment-events.repository.js';
/**
 * The confirm job's booking (T039, R-215, FR-361, FR-362, FR-375, FR-PAYG-19), each on the job's
 * transaction: an enrollment's parties read with no lock; every lock the confirmation takes, in
 * T005's order, and the enrollment read under them; `confirmEnrollment`, the only writer of
 * `confirmed_at` (R-HONEST-1); and the refusal of a paid event.
 */
export {
  type Confirmation,
  confirmationPartiesOf,
  confirmEnrollment,
  type EnrollmentParties,
  type LockedEnrollment,
  lockForConfirmation,
  type Refusal,
  refuseEnrollment,
} from './confirmation.service.js';
