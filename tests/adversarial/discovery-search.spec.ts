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
// each search meets both visible names. T070 runs every rule over a subject's name too. Every name
// begins with the world's own prefix, so each spelling is typed after it (`nameQuery`, 003:T079);
// the single letter is the prefix, a space and the letter.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { describe, expect, it } from 'vitest';

import {
  discoverySurface,
  excludedFrom,
  EXCLUDED_STATES,
  nameQuery,
  PLAIN_NAME,
  sharedSubjectQuery,
  SUBJECT_ENGLISH,
  SUBJECT_PLAIN,
  SUBJECT_VARIANT,
  VARIANT_NAME,
  visibleTo,
} from './discovery-world.js';
import { directions } from './procedure-harness.js';

const SEARCH_TIMEOUT_MS = 180_000;

/**
 * One typed search per spelling rule of FR-333, each folding to a prefix of `PLAIN_NAME`, and each
 * sent after the world's prefix (`nameQuery`).
 */
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
  // 003:T079, decision 10: no other world, of this run or another, bears one of this world's names.
  it('names every teacher of the world after its own prefix', async () => {
    const { world } = await discoverySurface();
    expect(world.prefix).toMatch(/^[0-9a-f]{8}$/);
    for (const teacher of world.teachers) {
      expect(teacher.displayName, `${teacher.gender} ${teacher.state}`).toMatch(
        new RegExp(`^${world.prefix} \\S`),
      );
    }
  });

  it('seeds a teacher in every excluded state of both genders, each named with the prefix', async () => {
    const { world } = await discoverySurface();
    const excluded = excludedFrom(world, requester);
    for (const state of EXCLUDED_STATES) {
      expect(excluded.filter((teacher) => teacher.state === state)).toHaveLength(2);
    }
    // The other gender's `otherName` is the one excluded name that does not begin with the prefix.
    for (const teacher of excluded.filter(({ state }) => state !== 'otherName')) {
      const named = [VARIANT_NAME, PLAIN_NAME].some((name) =>
        teacher.displayName.startsWith(nameQuery(world, name)),
      );
      expect(named, `${teacher.gender} ${teacher.state}`).toBe(true);
    }
  });

  // T079: a teacher committed visible for a moment is listed by another world's search, under a
  // name this world's checks refuse; the replacement comes before the first package, so it never is.
  it('offers no replaced payout account while it is still verified: the payout is replaced before the first package', async () => {
    const surface = await discoverySurface();
    const replaced = surface.world.teachers.filter(
      (teacher) => teacher.gender === requester && teacher.state === 'payoutReplaced',
    );
    expect(replaced).toHaveLength(1);
    for (const teacher of replaced) {
      const { replacedAt, firstPackageAt } = await surface.payoutReplacementOrder(teacher.id);
      expect(replacedAt, 'the replacement').not.toBeNull();
      expect(firstPackageAt, 'the first package').not.toBeNull();
      expect(Number(replacedAt), 'the replacement before the first package').toBeLessThan(
        Number(firstPackageAt),
      );
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

    const query = nameQuery(world, typed);
    const inSubject = await caller.discovery.browse({ subjectId: world.shared.id, query });
    expect(inSubject.cards.map(({ teacherId }) => teacherId).sort()).toEqual(matches);
    for (const card of inSubject.cards) {
      expect(card.match?.length, `${card.displayName}: the matched prefix`).toBeGreaterThan(0);
    }

    const everywhere = await caller.discovery.browse({ query });
    const answers = JSON.stringify([inSubject, everywhere]);
    for (const teacher of excluded) {
      expect(answers, `${teacher.gender} ${teacher.state}`).not.toContain(teacher.id);
    }
  });
});

// T070: the search by a subject's name folds as the name search does (FR-333, R-203). Each search
// types the shared subject's whole name, with one spelling rule, and its tag, so the answer across
// all subjects is exact: every visible teacher of the requester's gender (each teaches the shared
// subject, `otherName` included), none of them marked, since a subject matched and no name did, and
// nothing of an excluded teacher, in both directions.
const replaced = (from: string, to: string) => SUBJECT_PLAIN.replace(from, to);

const SUBJECT_SPELLINGS: ReadonlyArray<{
  readonly rule: string;
  readonly typed: string;
  /** Typed against the English name rather than the Arabic one. */
  readonly english?: true;
}> = [
  { rule: 'the plain spelling', typed: SUBJECT_PLAIN },
  { rule: 'أ counts as ا', typed: replaced('اصول', 'أصول') },
  { rule: 'إ counts as ا', typed: replaced('اقراء', 'إقراء') },
  { rule: 'آ counts as ا', typed: replaced(' ال ', ' آل ') },
  { rule: 'ى counts as ي', typed: replaced('الهدي', 'الهدى') },
  { rule: 'ئ counts as ي', typed: replaced('قاري', 'قارئ') },
  { rule: 'ؤ counts as و', typed: replaced('مودي', 'مؤدي') },
  { rule: 'ة counts as ه', typed: replaced('قراءه', 'قراءة') },
  { rule: 'the diacritics are removed (U+064B to U+065F)', typed: replaced('متن', 'مَتْن') },
  { rule: 'the superscript alef is removed (U+0670)', typed: replaced('متن', 'متٰن') },
  { rule: 'the tatweel is removed (U+0640)', typed: replaced('التجويد', 'التجويـد') },
  { rule: 'every rule at once', typed: SUBJECT_VARIANT },
  {
    rule: 'Latin letters lose their case (the English name)',
    typed: SUBJECT_ENGLISH.toUpperCase(),
    english: true,
  },
];

describe.each(directions)(
  'SC-314 over a subject’s name (T070), $name',
  { timeout: SEARCH_TIMEOUT_MS },
  ({ requester }) => {
    it.each(SUBJECT_SPELLINGS)(
      '$rule: every visible teacher of the subject and no excluded one',
      async ({ typed, english }) => {
        const surface = await discoverySurface();
        const { world } = surface;
        const { caller } = surface.student(requester);
        // The tag is the Arabic name's and the English name's alike; typed in upper case too.
        const query = english
          ? sharedSubjectQuery(world, typed).toUpperCase()
          : sharedSubjectQuery(world, typed);

        const answer = await caller.discovery.browse({ query });
        expect(answer.cards.map(({ teacherId }) => teacherId).sort()).toEqual(
          visibleTo(world, requester)
            .map(({ id }) => id)
            .sort(),
        );
        for (const card of answer.cards) expect(card.match, card.displayName).toBeUndefined();
        const serialized = JSON.stringify(answer);
        for (const teacher of excludedFrom(world, requester)) {
          expect(serialized, `${teacher.gender} ${teacher.state}`).not.toContain(teacher.id);
        }
      },
    );
  },
);
