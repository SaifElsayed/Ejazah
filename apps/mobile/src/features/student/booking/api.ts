// T044 (FR-350, FR-351): `booking.slots` and `checkout.hold` (T031, T032, T035) as the booking sheet
// calls them. The slots are read each time the sheet opens, a hold changing them for everyone; the
// hold is sent with the key the sheet keeps for the slot chosen, so a retry after a lost answer is
// one hold (FR-106, FR-357).
import type { BookingSlotsOutput, CheckoutHoldInput, CheckoutHoldOutput } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';

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
  return useMemo(
    () => ({
      /** The slot held for the package; refused with `SLOT_TAKEN`, `PREVIOUS_CHECKOUT` and others. */
      place: (input: CheckoutHoldInput): Promise<CheckoutHoldOutput> =>
        client.api.checkout.hold.mutate(input),
    }),
    [client],
  );
}
