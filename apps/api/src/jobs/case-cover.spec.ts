// T082 (R-215, FR-362, FR-PAYG-19; the owner's decisions of 2026-11-03 and 2026-11-04): which paid
// orders an enrollment's compensation cases cover. A case covers every paid order of its enrollment
// whose paid event was recorded before the case was opened, while it is open, or before it was
// closed (`resolved_at`, for `resolved` and `dismissed`), all three the database's instants. The
// enrollment's cases arrive folded by moderation (`CaseInstants`): whether one is open, the latest
// opening and the latest closing.
import { describe, expect, it } from 'vitest';

import type { CaseInstants } from '../modules/moderation/index.js';
import { covers } from './case-cover.js';

const OPENED = new Date('2026-11-04T08:00:00Z');
const CLOSED = new Date('2026-11-04T09:00:00Z');
const BEFORE_OPENING = new Date('2026-11-04T07:00:00Z');
const WHILE_OPEN = new Date('2026-11-04T08:30:00Z');
const AFTER_CLOSING = new Date('2026-11-04T10:00:00Z');

const open: CaseInstants = { open: true, lastOpenedAt: OPENED, lastClosedAt: null };
const closed: CaseInstants = { open: false, lastOpenedAt: OPENED, lastClosedAt: CLOSED };

describe('covers: an enrollment with no case (T082)', () => {
  it('covers no order', () => {
    expect(covers(null, WHILE_OPEN)).toBe(false);
  });
});

describe('covers: an open case (T082)', () => {
  it.each([
    ['paid before it was opened', BEFORE_OPENING],
    ['paid while it is open', WHILE_OPEN],
    ['paid in the millisecond it was opened', OPENED],
  ])('covers an order %s', (_name, paidAt) => {
    expect(covers(open, paidAt)).toBe(true);
  });
});

describe('covers: a case resolved or dismissed (T082)', () => {
  it.each([
    ['paid before it was opened', BEFORE_OPENING],
    ['paid while it was open', WHILE_OPEN],
    ['paid in the millisecond it was closed', CLOSED],
  ])('still covers an order %s', (_name, paidAt) => {
    expect(covers(closed, paidAt)).toBe(true);
  });

  it('does not cover an order paid after it was closed', () => {
    expect(covers(closed, AFTER_CLOSING)).toBe(false);
  });

  it('closed with no recorded closing, covers only what was paid before it was opened', () => {
    const unrecorded: CaseInstants = { open: false, lastOpenedAt: OPENED, lastClosedAt: null };
    expect(covers(unrecorded, BEFORE_OPENING)).toBe(true);
    expect(covers(unrecorded, WHILE_OPEN)).toBe(false);
  });
});

describe('covers: an enrollment with two cases (T082)', () => {
  it('one open and one closed: covers an order paid after the closed one was closed', () => {
    const both: CaseInstants = { open: true, lastOpenedAt: OPENED, lastClosedAt: CLOSED };
    expect(covers(both, AFTER_CLOSING)).toBe(true);
  });

  it('both closed: covers until the later closing, not after it', () => {
    const later = new Date('2026-11-04T09:30:00Z');
    const both: CaseInstants = { open: false, lastOpenedAt: CLOSED, lastClosedAt: later };
    expect(covers(both, later)).toBe(true);
    expect(covers(both, AFTER_CLOSING)).toBe(false);
  });
});

describe('covers: an order with no recorded paid event', () => {
  it('is covered by an open case, and by no closed one', () => {
    expect(covers(open, null)).toBe(true);
    expect(covers(closed, null)).toBe(false);
  });
});
