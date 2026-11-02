// T028 — SC-314: the name search never returns a hidden teacher, however the name is spelled
// (FR-333, FR-410, SC-304, SC-314; research R-203; R-GENDER-1, R-GENDER-5; SRS §3.7.1, `002:T143`).
//
// The world (`discovery-world.ts`) seeds, for each gender, two visible teachers whose names fold to
// one spelling, one written with every variant FR-333 folds and one written plain, a third visible
// teacher whose name holds the prefix but does not begin with it, and one teacher in each excluded
// state (the account suspended or banned; the application pending, rejected, suspended, revoked or
// banned; the payout account never verified, or replaced and not verified again; the account
// soft-deleted), each named with the visible prefix. Each search below is typed with one of
// FR-333's spellings (name-fold.spec.ts's equivalences, folded on both sides by `ijazah_fold`) and
// sent through the real `discovery.browse` in both directions: inside the world's subject it returns
// exactly the two visible matches, each with its matched length marked, and no other; across all
// subjects nothing of an excluded teacher appears, the other gender's included. A plain spelling
// typed against the variant one, and a variant typed against the plain one, are both covered, since
// each search meets both visible names.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { describe, expect, it } from 'vitest';

import {
  discoverySurface,
  excludedFrom,
  EXCLUDED_STATES,
  PLAIN_NAME,
  VARIANT_NAME,
  visibleTo,
} from './discovery-world.js';
import { directions } from './procedure-harness.js';

const SEARCH_TIMEOUT_MS = 180_000;

/** One typed search per spelling rule of FR-333, each folding to a prefix of `PLAIN_NAME`. */
const SPELLINGS: ReadonlyArray<{ readonly rule: string; readonly typed: string }> = [
  { rule: 'the plain spelling', typed: PLAIN_NAME },
  { rule: 'أ counts as ا', typed: 'أسامه' },
  { rule: 'إ counts as ا', typed: 'اسامه إبراهيم' },
  { rule: 'آ counts as ا', typed: 'اسامه ابراهيم آل' },
  { rule: 'ى counts as ي', typed: 'اسامه ابراهيم ال مصطفى' },
  { rule: 'ئ counts as ي', typed: 'اسامه ابراهيم ال مصطفي هانئ' },
  { rule: 'ؤ counts as و', typed: 'اسامه ابراهيم ال مصطفي هاني لؤي' },
  { rule: 'ة counts as ه', typed: 'اسامة' },
  { rule: 'the diacritics are removed (U+064B to U+065F)', typed: 'اُسَامَهٌ' },
  { rule: 'the superscript alef is removed (U+0670)', typed: 'اسامٰه' },
  { rule: 'the tatweel is removed (U+0640)', typed: 'اسـامـه' },
  { rule: 'Latin letters lose their case', typed: 'اسامه ابراهيم ال مصطفي هاني لوي YUSUF' },
  { rule: 'every rule at once', typed: VARIANT_NAME.toUpperCase() },
  { rule: 'a single folded letter', typed: 'إ' },
];

describe.each(directions)('SC-314, $name', { timeout: SEARCH_TIMEOUT_MS }, ({ requester }) => {
  it('seeds a teacher in every excluded state of both genders, each named with the prefix', async () => {
    const { world } = await discoverySurface();
    const excluded = excludedFrom(world, requester);
    for (const state of EXCLUDED_STATES) {
      expect(excluded.filter((teacher) => teacher.state === state)).toHaveLength(2);
    }
    // The other gender's `otherName` is the one excluded name that does not begin with the prefix.
    for (const teacher of excluded.filter(({ state }) => state !== 'otherName')) {
      const named = [VARIANT_NAME, PLAIN_NAME].some((name) => teacher.displayName.startsWith(name));
      expect(named, `${teacher.gender} ${teacher.state}`).toBe(true);
    }
  });

  it.each(SPELLINGS)('$rule: every visible match and no excluded teacher', async ({ typed }) => {
    const surface = await discoverySurface();
    const { world } = surface;
    const { caller } = surface.student(requester);
    const matches = visibleTo(world, requester)
      .filter((teacher) => teacher.state !== 'otherName')
      .map(({ id }) => id)
      .sort();
    const excluded = excludedFrom(world, requester);

    const inSubject = await caller.discovery.browse({ subjectId: world.shared.id, query: typed });
    expect(inSubject.cards.map(({ teacherId }) => teacherId).sort()).toEqual(matches);
    for (const card of inSubject.cards) {
      expect(card.match?.length, `${card.displayName}: the matched prefix`).toBeGreaterThan(0);
    }

    const everywhere = await caller.discovery.browse({ query: typed });
    const answers = JSON.stringify([inSubject, everywhere]);
    for (const teacher of excluded) {
      expect(answers, `${teacher.gender} ${teacher.state}`).not.toContain(teacher.id);
    }
  });
});
