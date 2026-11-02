// T026 (R-204, R-205, FR-332 to FR-335): discovery composed in booking. Catalog must not depend on
// booking, which depends on catalog, so the procedures live on booking's router and this service
// composes the two: catalog's discovery service for the tabs, the cards and the cursor (T025, its
// `DiscoveryCatalog` seam, bound by `main.ts` through catalog's entry), then booking's nearest free
// slot for the teachers of that page and no other (`nearest-slot.service.ts`). Both are asked with
// the requester's gender the procedure took from the session (R-GENDER-4, R-GENDER-5), so the slots
// are computed under the same visible set as the cards, and a card is never added, only completed.
import type {
  DiscoveryBrowseInput,
  discoveryBrowseOutput,
  DiscoveryFiltersInput,
  discoveryFiltersOutput,
} from '@ijazah/contracts';
import type { z } from 'zod';

import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { NearestSlots } from './nearest-slot.service.js';

export type { NearestSlots } from './nearest-slot.service.js';

type BrowseAnswer = z.input<typeof discoveryBrowseOutput>;

/** A result card as catalog builds it: everything but the nearest slot, which is booking's. */
export type CatalogDiscoveryCard = Omit<BrowseAnswer['cards'][number], 'nearestSlot'>;

/** One page as catalog answers it: the tabs on the first page, its cards, the cursor. */
export type CatalogDiscoveryPage = Omit<BrowseAnswer, 'cards'> & {
  readonly cards: readonly CatalogDiscoveryCard[];
};

/**
 * What booking asks of catalog's discovery service (T025), the seam `main.ts` binds through
 * catalog's entry. Each method takes the requester's gender from the session, never from input.
 */
export interface DiscoveryCatalog {
  browse(requester: RequesterGender, input: DiscoveryBrowseInput): Promise<CatalogDiscoveryPage>;
  filters(
    requester: RequesterGender,
    input: DiscoveryFiltersInput,
  ): Promise<z.input<typeof discoveryFiltersOutput>>;
}

export class DiscoveryService {
  readonly #catalog: DiscoveryCatalog;
  readonly #nearest: NearestSlots;

  constructor({ catalog, nearest }: { catalog: DiscoveryCatalog; nearest: NearestSlots }) {
    this.#catalog = catalog;
    this.#nearest = nearest;
  }

  /** `discovery.browse`: catalog's page, each card with its teacher's nearest free slot when one is. */
  async browse(requester: RequesterGender, input: DiscoveryBrowseInput): Promise<BrowseAnswer> {
    const page = await this.#catalog.browse(requester, input);
    const nearest = await this.#nearest.of(
      requester,
      page.cards.map(({ teacherId }) => teacherId),
    );
    return {
      ...page,
      cards: page.cards.map((card) => {
        const nearestSlot = nearest.get(card.teacherId);
        return nearestSlot === undefined ? card : { ...card, nearestSlot };
      }),
    };
  }

  /** `discovery.filters`: the riwayas of the subject's filter, catalog's answer as it is. */
  filters(
    requester: RequesterGender,
    input: DiscoveryFiltersInput,
  ): Promise<z.input<typeof discoveryFiltersOutput>> {
    return this.#catalog.filters(requester, input);
  }
}

/** The `discovery` procedures' services on the user surface (T026; T027 adds `teacher`). */
export type DiscoveryServices = Pick<DiscoveryService, 'browse' | 'filters'>;
