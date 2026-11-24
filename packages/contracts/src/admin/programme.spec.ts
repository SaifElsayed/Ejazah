// 006:T018 (FR-726, FR-727; admin-surface.md `programmes.queue` and `programmes.get`; the owner's
// answers of 2026-11-23 and 2026-11-24): what the administrator's two reads add, additive only
// (R-API-9), written before the fields and run red first.
//   - the queue offers `charge_unknown` beside `pay_blocked` (Q-1 (a), SRS DEC-113);
//   - a `no_offer` item carries whether the assessment was held (PR #158 r1 Q-R1 (b));
//   - `programmes.get` carries `cardSaved`, a boolean and never a card detail (Q-9 (a), SC-707), and,
//     on a closed programme with no `assessment` release, whether the assessment was held (PR #158 r2
//     Follow-up 2).
import { describe, expect, it } from 'vitest';

import {
  programmeRequestItem,
  programmesGetOutput,
  programmesQueueFilter,
  programmesQueueInput,
} from './programme.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const NO_OFFER = {
  requestId: id(1),
  kind: 'no_offer',
  status: 'open',
  createdAt: '2026-11-24T10:00:00.000Z',
} as const;

const PROGRAMME = {
  enrollmentId: id(2),
  teacher: { displayName: 'المعلمة سارة' },
  student: { displayName: 'آمال' },
  state: 'closed',
  offerDueAt: null,
  payBy: null,
  offer: null,
  plan: null,
  monthsPaid: 0,
  monthCount: null,
  nextDueAt: null,
  pausedAt: null,
  closedAt: '2026-11-24T12:00:00.000Z',
  orders: [],
  requests: [],
  cardSaved: false,
} as const;

describe('programmes.queue (006:T018)', () => {
  it('offers charge_unknown beside pay_blocked, and keeps refusal, unused (R-API-9)', () => {
    expect(programmesQueueFilter.options).toEqual([
      'paused',
      'stop',
      'refusal',
      'no_offer',
      'pay_blocked',
      'charge_unknown',
    ]);
    expect(programmesQueueInput.parse({ filter: 'charge_unknown' })).toEqual({
      filter: 'charge_unknown',
    });
  });

  it('carries on a no_offer item whether the assessment was held, and stays valid without it', () => {
    expect(programmeRequestItem.parse({ ...NO_OFFER, assessmentHeld: false })).toEqual({
      ...NO_OFFER,
      assessmentHeld: false,
    });
    expect(programmeRequestItem.parse(NO_OFFER)).toEqual(NO_OFFER);
    expect(() => programmeRequestItem.parse({ ...NO_OFFER, assessmentHeld: 'no' })).toThrow();
  });
});

describe('programmes.get (006:T018)', () => {
  it('requires cardSaved, a boolean', () => {
    expect(programmesGetOutput.parse(PROGRAMME)).toEqual(PROGRAMME);
    const { cardSaved: _, ...without } = PROGRAMME;
    expect(() => programmesGetOutput.parse(without)).toThrow();
    expect(() => programmesGetOutput.parse({ ...PROGRAMME, cardSaved: '4242' })).toThrow();
  });

  it('never carries a card detail: a token, the last four or the brand are stripped (SC-707)', () => {
    const parsed = programmesGetOutput.parse({
      ...PROGRAMME,
      cardSaved: true,
      card: { last4: '4242', brand: 'Visa' },
      token: 'placeholder-card-token',
      last4: '4242',
    });
    expect(parsed).toEqual({ ...PROGRAMME, cardSaved: true });
    expect(JSON.stringify(parsed)).not.toMatch(/4242|Visa|placeholder-card-token/);
  });

  it('carries whether the assessment was held on a closed programme, and stays valid without it', () => {
    expect(programmesGetOutput.parse({ ...PROGRAMME, assessmentHeld: false })).toEqual({
      ...PROGRAMME,
      assessmentHeld: false,
    });
    expect(programmesGetOutput.parse(PROGRAMME)).not.toHaveProperty('assessmentHeld');
  });
});
