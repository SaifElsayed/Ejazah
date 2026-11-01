// T004 — `ijazah_fold(text)` folds Arabic spelling the way FR-333 says (specs/003-booking/
// data-model.md §2.2, research R-203; SC-314's data).
//
// The one function the name search applies to the stored name and to the typed text alike: أ, إ
// and آ count as ا; ى and ئ as ي; ؤ as و; ة as ه; the diacritics (U+064B to U+065F, U+0670) and the
// tatweel (U+0640) are removed; Latin letters lose their case. Each probe folds a spelling variant
// and its plain form and expects one result, and folds a letter the rule leaves alone and expects
// it kept, so an over-wide fold is caught as well as a missing one. The catalogue probe holds the
// function IMMUTABLE and PARALLEL SAFE, with no column and no index built on it (analysis C1).
// Every probe runs as the application role, which may call the function.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAsApplication, type Db } from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

async function fold(text: string): Promise<string> {
  const { rows } = await db.query<{ folded: string }>('SELECT ijazah_fold($1) AS folded', [text]);
  return rows[0]?.folded ?? '';
}

/** Each equivalence of FR-333, as a variant and the form it folds to, both as a student types them. */
const equivalences: ReadonlyArray<{ rule: string; variant: string; plain: string }> = [
  { rule: 'أ counts as ا', variant: 'أحمد', plain: 'احمد' },
  { rule: 'إ counts as ا', variant: 'إبراهيم', plain: 'ابراهيم' },
  { rule: 'آ counts as ا', variant: 'آمنة', plain: 'امنه' },
  { rule: 'ى counts as ي', variant: 'مصطفى', plain: 'مصطفي' },
  { rule: 'ئ counts as ي', variant: 'هانئ', plain: 'هاني' },
  { rule: 'ؤ counts as و', variant: 'لؤي', plain: 'لوي' },
  { rule: 'ة counts as ه', variant: 'فاطمة', plain: 'فاطمه' },
  { rule: 'the diacritics are removed (U+064B to U+065F)', variant: 'مُحَمَّدٌ', plain: 'محمد' },
  { rule: 'the superscript alef is removed (U+0670)', variant: 'عبدالرحمٰن', plain: 'عبدالرحمن' },
  { rule: 'the tatweel is removed (U+0640)', variant: 'محـــمود', plain: 'محمود' },
  { rule: 'Latin letters lose their case', variant: 'Yusuf ALI', plain: 'yusuf ali' },
  { rule: 'every rule at once', variant: 'أُسامـة إِبراهيم', plain: 'اسامه ابراهيم' },
];

describe('ijazah_fold: the same normalisation on both sides (T004, FR-333, SC-314)', () => {
  it.each(equivalences)('$rule', async ({ variant, plain }) => {
    expect(await fold(variant)).toBe(await fold(plain));
    expect(await fold(plain)).toBe(plain);
  });

  it('leaves alone the letters the rule does not name', async () => {
    for (const kept of ['ا', 'ي', 'و', 'ه', 'ت', 'ء', 'ب', 'ن', ' ']) {
      expect(await fold(kept), kept).toBe(kept);
    }
    expect(await fold('هاني')).not.toBe(await fold('هانا'));
  });

  it('answers NULL for NULL', async () => {
    const { rows } = await db.query<{ folded: string | null }>(
      'SELECT ijazah_fold(NULL) AS folded',
    );
    expect(rows[0]?.folded).toBeNull();
  });

  it('is declared IMMUTABLE and PARALLEL SAFE, and nothing is stored or indexed through it', async () => {
    const { rows } = await db.query<{ volatility: string; parallel: string }>(
      `SELECT provolatile AS volatility, proparallel AS parallel FROM pg_proc
        WHERE proname = 'ijazah_fold' AND pronamespace = 'public'::regnamespace`,
    );
    expect(rows).toEqual([{ volatility: 'i', parallel: 's' }]);
    const { rows: indexes } = await db.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef ILIKE '%ijazah_fold%'`,
    );
    expect(indexes).toEqual([]);
    const { rows: columns } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name ILIKE '%fold%'`,
    );
    expect(columns).toEqual([]);
  });
});
