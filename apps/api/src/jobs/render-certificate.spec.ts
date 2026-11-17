// T008 of specs/005-certification (FR-606; R-401, R-402; contracts/jobs.md; B46 Q6 (a), Q8 (a) as the
// owner decided it on 2026-11-17): `render-certificate { ijazahId, generation }` over stand-ins. The
// render store's own semantics (the lock, the generation compared under it) are
// `tests/db-integrity/certificate-render.spec.ts`'s; the template's are `template/certificate.spec.ts`'s.
// Here the runner is a stand-in, never the binary: it reads the case the job wrote and writes a PDF.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  CertificateCase,
  MarkOutcome,
  RenderedMark,
  RenderSource,
} from '../modules/certification/index.js';
import type { TypstRun } from '../platform/typst/run-typst.js';
import { runOnceAndTwice } from './double-run.js';
import {
  type CertificateRenderSteps,
  RENDER_CERTIFICATE,
  renderCertificate,
  renderCertificatePayload,
  TypstNotConfigured,
} from './render-certificate.js';

const IJAZAH = '0199d0a0-0000-7000-8000-0000000008a1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000008b1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000008c1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000008c2';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000008d1';
const SIGNATURE_KEY = `ijazah-requests/${REQUEST}/signature.png`;
const STUDENT_NAME = 'مريم بنت أحمد بن علي';
const NOW = new Date('2026-11-17T12:00:00.000Z');
const TYPST = '/usr/local/bin/typst';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

interface Row {
  renderGeneration: number;
  renderedAt: Date | null;
  certificateStorageKey: string;
  signatureStorageKey: string | null;
}

interface World {
  readonly row: Row;
  readonly files: Map<string, Uint8Array>;
  readonly removed: string[];
  readonly lines: { level: string; fields: Record<string, unknown>; message: string }[];
  readonly cases: CertificateCase[];
  readonly runs: TypstRun[];
  /** Called inside the stand-in render, after the case is read (a re-render landing mid-render). */
  duringRender?: () => void;
}

function worldOf(row: Partial<Row> = {}): World {
  const files = new Map<string, Uint8Array>([[SIGNATURE_KEY, PNG]]);
  return {
    row: {
      renderGeneration: 0,
      renderedAt: null,
      certificateStorageKey: `certificates/${IJAZAH}/0.pdf`,
      signatureStorageKey: SIGNATURE_KEY,
      ...row,
    },
    files,
    removed: [],
    lines: [],
    cases: [],
    runs: [],
  };
}

function sourceOf(world: World): RenderSource {
  return {
    ijazahId: IJAZAH,
    requestId: REQUEST,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    subjectId: SUBJECT,
    language: 'ar',
    certificateNumber: 'IJZ-7Q4K-93XD',
    studentNamePrinted: STUDENT_NAME,
    teacherNamePrinted: 'فاطمة بنت علي',
    riwayaPrinted: 'حفص عن عاصم',
    tariqPrinted: 'الشاطبية',
    chainSnapshot: [['محمد ﷺ'], ['عثمان بن عفان', 'علي بن أبي طالب'], ['فاطمة بنت علي']],
    completionDate: new Date('2026-11-11T00:00:00.000Z'),
    grantedAt: new Date('2026-11-16T23:30:00.000Z'),
    renderGeneration: world.row.renderGeneration,
    renderedAt: world.row.renderedAt,
    signatureStorageKey: world.row.signatureStorageKey,
  };
}

/** The store as certification implements it, over the world's one row. */
function stepsOf(world: World): CertificateRenderSteps {
  return {
    source: async (ijazahId) => (ijazahId === IJAZAH ? sourceOf(world) : null),
    genders: async (userIds) =>
      // Each party's own gender, told apart, so the case is seen to take each from its own id.
      new Map(userIds.map((id) => [id, id === TEACHER ? 'male' : 'female'] as const)),
    timezoneOf: async () => 'Africa/Cairo',
    subjectOf: async () => ({ nameAr: 'القرآن الكريم', nameEn: 'The Holy Quran' }),
    mark: async (mark: RenderedMark): Promise<MarkOutcome> => {
      const { row } = world;
      if (row.renderGeneration !== mark.generation) {
        return {
          outcome: 'stale_generation',
          currentGeneration: row.renderGeneration,
          currentKey: row.certificateStorageKey,
        };
      }
      if (row.renderedAt !== null) return { outcome: 'already_rendered' };
      const previousKey = row.certificateStorageKey;
      row.certificateStorageKey = mark.storageKey;
      row.renderedAt = mark.at;
      return { outcome: 'written', previousKey };
    },
  };
}

/** The runner's stand-in: reads the case the job wrote, writes a PDF naming the generation read. */
function runnerOf(world: World) {
  return async (run: TypstRun): Promise<void> => {
    world.runs.push(run);
    const folder = run.args[run.args.indexOf('--root') + 1] ?? '';
    world.cases.push(JSON.parse(await readFile(join(folder, 'case.json'), 'utf8')) as CertificateCase);
    world.duringRender?.();
    await writeFile(run.args.at(-1) ?? '', `%PDF-stand-in`);
  };
}

/** The job over the world; `bin` null stands for an unset `TYPST_BIN`. */
function jobOf(world: World, bin: string | null = TYPST) {
  return renderCertificate({
    steps: stepsOf(world),
    storage: {
      read: async (key) => {
        const body = world.files.get(key);
        if (body === undefined) throw new Error('nothing stored there');
        return { body, contentType: 'image/png' };
      },
      put: async (key, body) => {
        world.files.set(key, body);
      },
      remove: async (key) => {
        world.removed.push(key);
        world.files.delete(key);
      },
    },
    typstBin: bin ?? undefined,
    run: runnerOf(world),
    log: {
      info: (fields, message) => world.lines.push({ level: 'info', fields, message }),
      warn: (fields, message) => world.lines.push({ level: 'warn', fields, message }),
    },
    clock: () => NOW,
  });
}

const observe = (world: World) => ({
  row: { ...world.row },
  files: [...world.files.keys()].sort(),
  removed: [...world.removed],
});

describe('render-certificate (T008)', () => {
  it('is named as the queue carries it, its payload the ijazah and the generation as text', () => {
    const job = jobOf(worldOf());
    expect(job.name).toBe(RENDER_CERTIFICATE);
    expect(RENDER_CERTIFICATE).toBe('render-certificate');
    expect(renderCertificatePayload(IJAZAH, 2)).toEqual({ ijazahId: IJAZAH, generation: '2' });
  });

  it('renders the payload’s generation, puts it under its own key and records it (R-API-14: twice is once)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => worldOf(),
      run: (world) => jobOf(world).handle(renderCertificatePayload(IJAZAH, 0)),
      observe,
    });
    expect(twice).toEqual(once);
    expect(once).toEqual({
      row: {
        renderGeneration: 0,
        renderedAt: NOW,
        certificateStorageKey: `certificates/${IJAZAH}/0.pdf`,
        signatureStorageKey: SIGNATURE_KEY,
      },
      files: [`certificates/${IJAZAH}/0.pdf`, SIGNATURE_KEY].sort(),
      removed: [],
    });
  });

  it('renders once only: a second delivery of a rendered generation runs no render', async () => {
    const world = worldOf();
    const job = jobOf(world);
    await job.handle(renderCertificatePayload(IJAZAH, 0));
    await job.handle(renderCertificatePayload(IJAZAH, 0));
    expect(world.runs).toHaveLength(1);
    expect(world.lines.at(-1)?.fields).toEqual({
      ijazahId: IJAZAH,
      generation: 0,
      reason: 'already_rendered',
    });
  });

  it('hands the template the ijazah’s printed fields, both genders and both calendars', async () => {
    const world = worldOf();
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 0));
    expect(world.cases).toEqual([
      {
        language: 'ar',
        teacherGender: 'male',
        studentGender: 'female',
        studentName: STUDENT_NAME,
        teacherName: 'فاطمة بنت علي',
        subjectName: 'القرآن الكريم',
        riwaya: 'حفص عن عاصم',
        tariq: 'الشاطبية',
        generations: [['محمد ﷺ'], ['عثمان بن عفان', 'علي بن أبي طالب'], ['فاطمة بنت علي']],
        generationCount: '٣',
        completionDate: { hijri: '١ جمادى الآخرة ١٤٤٨ هـ', gregorian: '١١ نوفمبر ٢٠٢٦' },
        // 23:30 UTC on the 16th is the 17th in Cairo, the teacher's zone.
        issueDate: { hijri: '٧ جمادى الآخرة ١٤٤٨ هـ', gregorian: '١٧ نوفمبر ٢٠٢٦' },
        certificateNumber: 'IJZ-7Q4K-93XD',
        signatureFile: 'signature.png',
      },
    ]);
    expect(world.runs[0]?.bin).toBe(TYPST);
  });

  it('writes nothing for an older generation, running no render', async () => {
    const world = worldOf({ renderGeneration: 2 });
    const before = observe(world);
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 1));
    expect(observe(world)).toEqual(before);
    expect(world.runs).toEqual([]);
    expect(world.lines).toEqual([
      {
        level: 'info',
        fields: { ijazahId: IJAZAH, generation: 1, currentGeneration: 2, reason: 'stale_generation' },
        message: 'A certificate render was skipped',
      },
    ]);
  });

  it('writes nothing when a re-render lands during its render, removing no file the row names', async () => {
    const world = worldOf({ renderGeneration: 1, certificateStorageKey: `certificates/${IJAZAH}/1.pdf` });
    world.files.set(`certificates/${IJAZAH}/1.pdf`, PNG);
    world.duringRender = () => {
      world.row.renderGeneration = 2;
    };
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 1));
    expect(world.row).toEqual({
      renderGeneration: 2,
      renderedAt: null,
      certificateStorageKey: `certificates/${IJAZAH}/1.pdf`,
      signatureStorageKey: SIGNATURE_KEY,
    });
    expect(world.removed).toEqual([]);
    expect(world.lines.at(-1)?.fields).toEqual({
      ijazahId: IJAZAH,
      generation: 1,
      currentGeneration: 2,
      reason: 'stale_generation',
    });
  });

  it('removes a stale render’s own file after the commit when the row points elsewhere', async () => {
    const world = worldOf({ renderGeneration: 1, certificateStorageKey: `certificates/${IJAZAH}/0.pdf` });
    world.duringRender = () => {
      world.row.renderGeneration = 2;
    };
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 1));
    expect(world.row.renderedAt).toBeNull();
    expect(world.removed).toEqual([`certificates/${IJAZAH}/1.pdf`]);
    expect(world.files.has(`certificates/${IJAZAH}/0.pdf`)).toBe(false);
  });

  it('removes the previous generation’s file once a newer one is recorded ⚠️ automatic', async () => {
    const world = worldOf({ renderGeneration: 2, certificateStorageKey: `certificates/${IJAZAH}/1.pdf` });
    world.files.set(`certificates/${IJAZAH}/1.pdf`, PNG);
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 2));
    expect(world.row.certificateStorageKey).toBe(`certificates/${IJAZAH}/2.pdf`);
    expect(world.removed).toEqual([`certificates/${IJAZAH}/1.pdf`]);
    expect([...world.files.keys()].sort()).toEqual([`certificates/${IJAZAH}/2.pdf`, SIGNATURE_KEY].sort());
  });

  it('refuses to render without the signature copy: signature_missing, by ids only, nothing written', async () => {
    const world = worldOf({ signatureStorageKey: null });
    const before = observe(world);
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 0));
    expect(world.runs).toEqual([]);
    expect(observe(world)).toEqual(before);
    expect(world.lines).toEqual([
      {
        level: 'warn',
        fields: { ijazahId: IJAZAH, requestId: REQUEST, reason: 'signature_missing' },
        message: 'A certificate render was refused',
      },
    ]);
  });

  it('skips an unknown ijazah, writing nothing', async () => {
    const world = worldOf();
    await jobOf(world).handle({ ijazahId: '0199d0a0-0000-7000-8000-0000000008ff', generation: '0' });
    expect(world.runs).toEqual([]);
    expect(world.lines.at(-1)?.fields).toEqual({
      ijazahId: '0199d0a0-0000-7000-8000-0000000008ff',
      generation: 0,
      reason: 'not_found',
    });
  });

  it('fails into the retries when TYPST_BIN is not set, writing nothing', async () => {
    const world = worldOf();
    const before = observe(world);
    await expect(jobOf(world, null).handle(renderCertificatePayload(IJAZAH, 0))).rejects.toBeInstanceOf(
      TypstNotConfigured,
    );
    expect(observe(world)).toEqual(before);
  });

  it('refuses a payload whose generation is not a whole number', async () => {
    const world = worldOf();
    await expect(jobOf(world).handle({ ijazahId: IJAZAH, generation: '1.5' })).rejects.toThrow();
    await expect(jobOf(world).handle({ ijazahId: IJAZAH, generation: '-1' })).rejects.toThrow();
    expect(world.runs).toEqual([]);
  });

  it('logs ids, generations and reasons only, never a name or a key', async () => {
    const world = worldOf({ renderGeneration: 1, certificateStorageKey: `certificates/${IJAZAH}/0.pdf` });
    await jobOf(world).handle(renderCertificatePayload(IJAZAH, 1));
    const refused = worldOf({ signatureStorageKey: null });
    await jobOf(refused).handle(renderCertificatePayload(IJAZAH, 0));
    const logged = JSON.stringify([...world.lines, ...refused.lines]);
    expect(world.lines.length + refused.lines.length).toBeGreaterThan(1);
    expect(logged).not.toContain(STUDENT_NAME);
    expect(logged).not.toContain('certificates/');
    expect(logged).not.toContain('ijazah-requests/');
  });
});
