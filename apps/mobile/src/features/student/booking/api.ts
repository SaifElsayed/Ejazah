// T044 (FR-350, FR-351): `booking.slots` and `checkout.hold` (T031, T032, T035) as the booking sheet
// calls them. The slots are read each time the sheet opens, a hold changing them for everyone; the
// hold is sent with the key the sheet keeps for the slot chosen, so a retry after a lost answer is
// one hold (FR-106, FR-357). A hold placed, or refused `PREVIOUS_CHECKOUT`, marks the checkout's
// `checkout.current` stale, so the screen it leads to reads it again (PR #121's review, round 1).
import type { BookingSlotsOutput, CheckoutHoldInput, CheckoutHoldOutput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { CHECKOUT_CURRENT_QUERY_KEY } from '../checkout/keys';

export const bookingSlotsQueryKey = (packageId: string) =>
  ['student', 'booking', 'slots', packageId] as const;

export function useBookingSlots(packageId: string) {
  const { client } = useApi();
  return useQuery<BookingSlotsOutput>({
    queryKey: bookingSlotsQueryKey(packageId),
    queryFn: () => client.api.booking.slots.query({ packageId }),
  });
}

export function useHold() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(() => {
    const stale = () => queries.invalidateQueries({ queryKey: CHECKOUT_CURRENT_QUERY_KEY });
    return {
      /** The slot held for the package; refused with `SLOT_TAKEN`, `PREVIOUS_CHECKOUT` and others. */
      place: async (input: CheckoutHoldInput): Promise<CheckoutHoldOutput> => {
        try {
          const held = await client.api.checkout.hold.mutate(input);
          await stale();
          return held;
        } catch (error) {
          if (errorCodeOf(error) === 'PREVIOUS_CHECKOUT') await stale();
          throw error;
        }
      },
    };
  }, [client, queries]);
}
