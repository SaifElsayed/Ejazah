// T083 (FR-143, FR-144, public-pages.md "The pages"): the web deletion pages, `GET /delete-account`,
// `POST /delete-account` and `POST /delete-account/confirm`, over T019's helper. B16's step zero
// fixes the factory's shape; lane B of B16 builds the pages from T081's spec.
import type { WebRoute } from '../../../platform/web/route.js';
import type { DeletionService } from '../deletion.service.js';

/** What the pages are built over; lane B adds what the pages need beside these. */
export interface DeleteAccountRouteDependencies {
  readonly deletion: Pick<DeletionService, 'requestWebCode' | 'confirmWebDeletion'>;
  /** The support address the done page names, from the configuration (FR-145). */
  readonly supportEmail: string;
}

/** The deletion pages by path, for `main.ts` to mount with the other public pages. */
export function deleteAccountRoutes(
  _dependencies: DeleteAccountRouteDependencies,
): Readonly<Record<string, WebRoute>> {
  return {};
}
