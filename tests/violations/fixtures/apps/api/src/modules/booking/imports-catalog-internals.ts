// T020 fixture — VIOLATION of R-API-3: booking reaches past catalog's public entry into one
// of its internals. The legal import is `../catalog`.
// Refused by boundaries/no-deep-module-import.
import { publishedPackageIds } from '../catalog/catalog.service';

export function packagesForBooking(): readonly string[] {
  return publishedPackageIds();
}
