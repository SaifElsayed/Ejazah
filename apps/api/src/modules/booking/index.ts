// PUBLIC ENTRY of the booking module (T017). Other modules import this file and nothing below it (R-API-3).

/**
 * What catalog's `CatalogUse` port asks of booking (T020, R-207), on the caller's transaction:
 * whether a slot is in use and whether a package has an enrollment. `main.ts` binds them.
 */
export { packageHasEnrollment, slotInUse } from './catalog-use.repository.js';
