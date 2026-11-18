// T008 of specs/005-certification (FR-606; FR-IJAZAH-2, FR-IJAZAH-11; R-401; ADR 0004 D1-D3): the
// template compiled by the real Typst 0.15.1, and what it placed read back.
//
// It runs where `TYPST_BIN` names the binary (CI's unit job installs the pinned one; locally the
// owner-approved binary is set on the command line) and is skipped elsewhere: a condition on the
// environment, as a database spec's tag is (`no-focused-or-skipped-test`, T041).
//
// HOW IT READS. The page count is the PDF's own page tree (`/Type /Pages /Count n`). The words are
// read with `typst eval --in`, which queries the placed document by the template's labels
// (`<body>`, `<closing>`, `<grantor-label>`, `<student-name>`, `<generation>`, `<layout>`) and
// answers JSON; the text is the placed text nodes joined. A PDF's Arabic text layer cannot be
// searched (ADR 0004, «The text layer»), so the labels are how the words are seen.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runTypst } from '../../../platform/typst/run-typst.js';
import {
  CERTIFICATE_FONTS_DIRECTORY,
  CERTIFICATE_TEMPLATE_FILE,
  type CertificateCase,
  type CertificateGender,
  type CertificateLanguage,
  compileArguments,
  prepareCertificateFolder,
  renderCertificatePdf,
  type SignatureImage,
} from './certificate-case.js';

const bin = process.env['TYPST_BIN'];
const TIMEOUT = 60_000;

/** A one-pixel PNG, the signature copy's stand-in. */
const PIXEL_PNG: SignatureImage = {
  body: Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  ),
  contentType: 'image/png',
};

const ATTESTED = ['محمد ﷺ', 'جبريل عليه السلام', 'عبد الله بن مسعود', 'زر بن حبيش', 'عاصم بن أبي النجود'];

/** `count` generations of one name each, origin first, the teacher's last. */
function chainOf(count: number): string[][] {
  return Array.from({ length: count }, (_, index) =>
    index === count - 1
      ? ['أحمد بن محمد المُجيز']
      : [`${ATTESTED[index % ATTESTED.length] ?? ''} ${String(index + 1)}`],
  );
}

interface CaseOptions {
  readonly language?: CertificateLanguage;
  readonly teacherGender?: CertificateGender;
  readonly studentGender?: CertificateGender;
  readonly generations?: readonly (readonly string[])[];
  readonly studentName?: string;
  readonly tariq?: string | null;
}

function caseOf(options: CaseOptions = {}): Omit<CertificateCase, 'signatureFile'> {
  const generations = options.generations ?? chainOf(25);
  const language = options.language ?? 'ar';
  return {
    language,
    teacherGender: options.teacherGender ?? 'male',
    studentGender: options.studentGender ?? 'male',
    studentName: options.studentName ?? 'عمر بن خالد الأنصاري',
    teacherName: 'أحمد بن محمد المُجيز',
    subjectName: language === 'ar' ? 'القرآن الكريم' : 'The Holy Quran',
    riwaya: 'حفص عن عاصم',
    tariq: options.tariq === undefined ? 'الشاطبية' : options.tariq,
    generations,
    generationCount: String(generations.length),
    completionDate: { hijri: '1 Jumada II 1448 AH', gregorian: '11 November 2026' },
    issueDate: { hijri: '7 Jumada II 1448 AH', gregorian: '17 November 2026' },
    certificateNumber: 'IJZ-7Q4K-93XD',
  };
}

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

interface Compiled {
  readonly pdf: Uint8Array;
  /** The placed text under a label, each match's text joined. */
  readonly textOf: (label: string) => string[];
  /** Each match's value under a metadata label. */
  readonly valuesOf: (label: string) => unknown[];
}

/** Concatenates the placed text nodes of a queried element, a space for each space. */
function plainText(node: unknown): string {
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (typeof node !== 'object' || node === null) return '';
  const element = node as Record<string, unknown>;
  if (element['func'] === 'space') return ' ';
  if (element['func'] === 'text' && typeof element['text'] === 'string') return element['text'];
  return Object.entries(element)
    .filter(([key]) => key !== 'label' && key !== 'func' && key !== 'styles')
    .map(([, value]) => plainText(value))
    .join('');
}

async function compile(
  certificate: Omit<CertificateCase, 'signatureFile'>,
  signature: SignatureImage | null = PIXEL_PNG,
): Promise<Compiled> {
  const typst = bin ?? '';
  const folder = await mkdtemp(join(tmpdir(), 'certificate-spec-'));
  folders.push(folder);
  const template = await prepareCertificateFolder(folder, certificate, signature);
  const output = join(folder, 'out.pdf');
  await runTypst({ bin: typst, args: compileArguments(folder, template, output) });
  const pdf = new Uint8Array(await readFile(output));
  const query = (expression: string): unknown =>
    JSON.parse(
      execFileSync(
        typst,
        [
          'eval',
          '--root',
          folder,
          '--font-path',
          CERTIFICATE_FONTS_DIRECTORY,
          '--ignore-system-fonts',
          '--format',
          'json',
          '--in',
          template,
          expression,
        ],
        { encoding: 'utf8' },
      ),
    );
  return {
    pdf,
    textOf: (label) => (query(`query(<${label}>)`) as unknown[]).map(plainText),
    valuesOf: (label) => query(`query(<${label}>).map(it => it.value)`) as unknown[],
  };
}

/** The PDF's own page count, from its page tree. */
function pagesOf(pdf: Uint8Array): number {
  const match = /\/Type\s*\/Pages\s*\/Count\s+(\d+)/.exec(Buffer.from(pdf).toString('latin1'));
  if (match?.[1] === undefined) throw new Error('no page tree in the PDF');
  return Number(match[1]);
}

describe.skipIf(bin === undefined)('the certificate template (T008)', { timeout: TIMEOUT }, () => {
  it('imports no package and never evaluates a value', async () => {
    const source = await readFile(CERTIFICATE_TEMPLATE_FILE, 'utf8');
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/#import|@preview|@local/);
  });

  it.each([
    [1, 1, 'one-page'],
    [25, 1, 'one-page'],
    [60, 1, 'one-page'],
    [61, 2, 'flow'],
  ])('a chain of %i generations takes %i page(s), laid out %s', async (count, pages, layout) => {
    const compiled = await compile(caseOf({ generations: chainOf(count) }));
    expect(pagesOf(compiled.pdf)).toBe(pages);
    expect(compiled.valuesOf('layout')).toEqual([layout]);
    expect(compiled.valuesOf('generation')).toHaveLength(count);
  });

  it('draws a multi-name generation as one generation holding every name', async () => {
    const companions = ['عثمان بن عفان', 'علي بن أبي طالب', 'أبي بن كعب', 'زيد بن ثابت'];
    const generations = [['محمد ﷺ'], companions, ['زر بن حبيش'], ['أحمد بن محمد المُجيز']];
    const compiled = await compile(caseOf({ generations }));
    expect(compiled.valuesOf('generation')).toEqual(generations);
    expect(pagesOf(compiled.pdf)).toBe(1);
  });

  it.each([
    // Markup that would compile if evaluated, and print other characters.
    ['styling markup', String.raw`عمر *bold* _x_ #text(red)[z] #("a" + "b")`],
    // Markup that would not even compile if evaluated.
    ['code, a label and a reference', String.raw`عمر #eval("1+1") $y$ <l> @r \ ]`],
  ])('prints a name holding %s as its own characters', async (_kind, studentName) => {
    for (const language of ['ar', 'en'] as const) {
      const compiled = await compile(caseOf({ language, studentName }));
      expect(compiled.textOf('student-name')).toEqual([studentName]);
    }
  });

  describe.each([
    {
      teacher: 'male',
      student: 'male',
      ar: ['فقد قرأ عليَّ الأخُ الكريم', 'وأتمّها', 'وقد أجزتُه بأن يقرأ ويُقرئ بما قرأ به عليَّ', 'وأوصيه', 'ينساني من صالح دعائه'],
      arClosing: 'وكتبه المُجيز: أحمد بن محمد المُجيز',
      arLabel: 'المُجيز',
      en: ['which he completed', 'I hereby grant him ijazah', 'what he read to me', 'I counsel him', 'in his prayers'],
      enClosing: 'The grantor, أحمد بن محمد المُجيز, has set his signature below.',
    },
    {
      teacher: 'male',
      student: 'female',
      ar: ['فقد قرأت عليَّ الأختُ الكريمة', 'وأتمّتها', 'وقد أجزتُها بأن تقرأ وتُقرئ بما قرأت به عليَّ', 'وأوصيها', 'تنساني من صالح دعائها'],
      arClosing: 'وكتبه المُجيز: أحمد بن محمد المُجيز',
      arLabel: 'المُجيز',
      en: ['which she completed', 'I hereby grant her ijazah', 'what she read to me', 'I counsel her', 'in her prayers'],
      enClosing: 'The grantor, أحمد بن محمد المُجيز, has set his signature below.',
    },
    {
      teacher: 'female',
      student: 'male',
      ar: ['فقد قرأ عليَّ الأخُ الكريم', 'وأتمّها', 'وقد أجزتُه بأن يقرأ ويُقرئ بما قرأ به عليَّ', 'وأوصيه', 'ينساني من صالح دعائه'],
      arClosing: 'وكتبته المُجيزة: أحمد بن محمد المُجيز',
      arLabel: 'المُجيزة',
      en: ['which he completed', 'I hereby grant him ijazah', 'what he read to me', 'I counsel him', 'in his prayers'],
      enClosing: 'The grantor, أحمد بن محمد المُجيز, has set her signature below.',
    },
    {
      teacher: 'female',
      student: 'female',
      ar: ['فقد قرأت عليَّ الأختُ الكريمة', 'وأتمّتها', 'وقد أجزتُها بأن تقرأ وتُقرئ بما قرأت به عليَّ', 'وأوصيها', 'تنساني من صالح دعائها'],
      arClosing: 'وكتبته المُجيزة: أحمد بن محمد المُجيز',
      arLabel: 'المُجيزة',
      en: ['which she completed', 'I hereby grant her ijazah', 'what she read to me', 'I counsel her', 'in her prayers'],
      enClosing: 'The grantor, أحمد بن محمد المُجيز, has set her signature below.',
    },
  ] as const)('a $teacher teacher and a $student student', (words) => {
    const genders = {
      teacherGender: words.teacher,
      studentGender: words.student,
    } as const;

    it('prints the Arabic text in their verb forms', async () => {
      const compiled = await compile(caseOf({ ...genders, language: 'ar' }));
      const [body] = compiled.textOf('body');
      for (const phrase of words.ar) expect(body).toContain(phrase);
      expect(compiled.textOf('closing')).toEqual([words.arClosing]);
      expect(compiled.textOf('grantor-label')).toEqual([words.arLabel]);
    });

    it('prints the English text in their pronouns', async () => {
      const compiled = await compile(caseOf({ ...genders, language: 'en' }));
      const [body] = compiled.textOf('body');
      for (const phrase of words.en) expect(body).toContain(phrase);
      expect(compiled.textOf('closing')).toEqual([words.enClosing]);
      expect(compiled.textOf('grantor-label')).toEqual(['The grantor']);
    });
  });

  it('leaves the tariq out in both languages when the credential names none', async () => {
    const arabic = await compile(caseOf({ language: 'ar', tariq: null }));
    expect(arabic.textOf('body')[0]).toContain('برواية حفص عن عاصم، قراءةً');
    expect(arabic.textOf('body')[0]).not.toContain('من طريق');
    const english = await compile(caseOf({ language: 'en', tariq: null }));
    expect(english.textOf('body')[0]).toContain('in the riwaya of حفص عن عاصم, a complete');
    expect(english.textOf('body')[0]).not.toContain('tariq');
  });

  it('renders through the job’s call to PDF bytes, leaving the template as it was', async () => {
    const before = await readFile(CERTIFICATE_TEMPLATE_FILE, 'utf8');
    const pdf = await renderCertificatePdf({
      run: runTypst,
      bin: bin ?? '',
      certificate: caseOf({ language: 'en' }),
      signature: PIXEL_PNG,
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pagesOf(pdf)).toBe(1);
    expect(await readFile(CERTIFICATE_TEMPLATE_FILE, 'utf8')).toBe(before);
  });
});
