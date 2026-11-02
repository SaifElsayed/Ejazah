// T026 — R-205's occupancy and FR-394's release week, as rules over what booking's rows say. A slot
// is taken while an active hold or an enrollment awaiting payment uses it; a confirmed enrollment
// holds it on every local date before its release, the week after its final session plus
// `slot_release_buffer_weeks` (FR-BOOK-10), and a confirmed enrollment whose last session cannot be
// read keeps its slot (the side that refuses rather than offers). What the rows say on Postgres, and
// `slotInUse` over them, are `tests/db-integrity/discovery-slots.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import { isFreeOn, occupancyFrom, releaseDateOf, type SlotUse } from './slot-occupancy.service.js';

const SLOT = '0199d0a0-0000-7000-8000-0000000000b1';
const FIRST = '0199d0a0-0000-7000-8000-0000000000b2';
const SECOND = '0199d0a0-0000-7000-8000-0000000000b3';
const CAIRO = 'Africa/Cairo';

/** A Thursday slot whose enrollment's final session is Thursday 2026-11-26. */
const LAST = '2026-11-26';

function use(values: Partial<SlotUse> = {}): SlotUse {
  return { slotId: SLOT, taken: false, confirmed: [], ...values };
}

describe('releaseDateOf (FR-394, FR-BOOK-10)', () => {
  it('releases from the week after the final session with no buffer', () => {
    expect(releaseDateOf(LAST, 0)).toBe('2026-12-03');
  });

  it('adds the buffer in whole weeks', () => {
    expect(releaseDateOf(LAST, 1)).toBe('2026-12-10');
    expect(releaseDateOf(LAST, 2)).toBe('2026-12-17');
  });
});

describe('occupancyFrom and isFreeOn (R-205)', () => {
  it('leaves a slot nothing uses free on every date', () => {
    expect(occupancyFrom(use(), new Map(), 0)).toBeUndefined();
    expect(isFreeOn(undefined, '2026-11-05')).toBe(true);
  });

  it('takes a slot an active hold or an enrollment awaiting payment uses, whatever the date', () => {
    const occupancy = occupancyFrom(use({ taken: true }), new Map(), 0);
    expect(occupancy).toEqual({ kind: 'taken' });
    expect(isFreeOn(occupancy, '2030-01-01')).toBe(false);
  });

  it('holds a confirmed enrollment’s slot before its release week and frees it from that week (FR-394)', () => {
    const confirmed = use({ confirmed: [{ enrollmentId: FIRST, timezone: CAIRO }] });
    const occupancy = occupancyFrom(confirmed, new Map([[FIRST, LAST]]), 0);
    expect(occupancy).toEqual({ kind: 'until', releasedOn: '2026-12-03', timezone: CAIRO });
    expect(isFreeOn(occupancy, LAST)).toBe(false);
    expect(isFreeOn(occupancy, '2026-12-02')).toBe(false);
    expect(isFreeOn(occupancy, '2026-12-03')).toBe(true);
    expect(isFreeOn(occupancy, '2026-12-10')).toBe(true);
  });

  it('keeps the slot through the buffer weeks', () => {
    const confirmed = use({ confirmed: [{ enrollmentId: FIRST, timezone: CAIRO }] });
    const occupancy = occupancyFrom(confirmed, new Map([[FIRST, LAST]]), 1);
    expect(isFreeOn(occupancy, '2026-12-03')).toBe(false);
    expect(isFreeOn(occupancy, '2026-12-10')).toBe(true);
  });

  it('releases from the latest of several confirmed enrollments', () => {
    const confirmed = use({
      confirmed: [
        { enrollmentId: FIRST, timezone: CAIRO },
        { enrollmentId: SECOND, timezone: CAIRO },
      ],
    });
    const occupancy = occupancyFrom(
      confirmed,
      new Map([
        [FIRST, '2026-12-24'],
        [SECOND, LAST],
      ]),
      0,
    );
    expect(occupancy).toEqual({ kind: 'until', releasedOn: '2026-12-31', timezone: CAIRO });
  });

  it('keeps the slot of a confirmed enrollment whose last session cannot be read', () => {
    const confirmed = use({
      confirmed: [
        { enrollmentId: FIRST, timezone: CAIRO },
        { enrollmentId: SECOND, timezone: CAIRO },
      ],
    });
    expect(occupancyFrom(confirmed, new Map([[FIRST, LAST]]), 0)).toEqual({ kind: 'taken' });
  });

  it('lets an active hold win over a confirmed enrollment’s release', () => {
    const both = use({ taken: true, confirmed: [{ enrollmentId: FIRST, timezone: CAIRO }] });
    expect(occupancyFrom(both, new Map([[FIRST, LAST]]), 0)).toEqual({ kind: 'taken' });
  });
});
