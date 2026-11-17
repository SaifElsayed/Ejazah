// T008 of specs/005-certification (FR-606; FR-IJAZAH-2; R-401; ADR 0004 D1): the case the template
// prints, written as `case.json` beside a copy of `certificate.typ` in a folder of its own, and the
// one call that turns it into a PDF through the kernel's Typst runner.
//
// THE CASE IS DATA (ADR 0004, Consequences): every printed value is a string the template places as
// text, never through `eval`, so a name holding Typst markup prints its characters. The dates and
// the count of generations are formatted by the job (Hijri and Gregorian, FR-IJAZAH-2), never by the
// template. The genders choose the words of the owner's approved text (2026-11-17).
//
// THE FOLDER. Typst reads only below `--root`, so each render gets a fresh folder in the system's
// temporary directory holding the template, the case and the signature copy, and nothing else; the
// fonts come from the vendored Amiri beside this file (`--font-path`), the system's never
// (`--ignore-system-fonts`). The template imports no package, so the compiler fetches nothing. The
// folder is removed when the render settles, whatever its outcome.
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TypstRunner } from '../../../platform/typst/run-typst.js';

export type CertificateLanguage = 'ar' | 'en';
export type CertificateGender = 'male' | 'female';

/** A date as the certificate prints it, in both calendars (FR-IJAZAH-2). */
export interface PrintedDate {
  readonly hijri: string;
  readonly gregorian: string;
}

/** `case.json`: everything the template prints, as JSON data. */
export interface CertificateCase {
  readonly language: CertificateLanguage;
  readonly teacherGender: CertificateGender;
  readonly studentGender: CertificateGender;
  readonly studentName: string;
  readonly teacherName: string;
  readonly subjectName: string;
  readonly riwaya: string;
  /** Null when the credential names no tariq: its phrases are left out. */
  readonly tariq: string | null;
  /** Origin first, each generation one or more names, the teacher's last (FR-ISNAD-7). */
  readonly generations: readonly (readonly string[])[];
  /** The number of generations, formatted in the certificate's language. */
  readonly generationCount: string;
  readonly completionDate: PrintedDate;
  readonly issueDate: PrintedDate;
  readonly certificateNumber: string;
  /** The signature copy's file name in the render folder; set by `prepareCertificateFolder`. */
  readonly signatureFile: string | null;
}

/** The teacher's signature copy, as `StoragePort.read` hands it back. */
export interface SignatureImage {
  readonly body: Uint8Array;
  readonly contentType: string;
}

/** The signature types the upload accepts (catalog's `SignatureType`), and the name each is written as. */
const SIGNATURE_FILE_OF: Readonly<Record<string, string>> = {
  'image/png': 'signature.png',
  'image/jpeg': 'signature.jpg',
};

// From src/ and from dist/ alike: four levels up is apps/api (the breached-password list's precedent).
const TEMPLATE_DIRECTORY = fileURLToPath(
  new URL('../../../../src/modules/certification/template/', import.meta.url),
);
export const CERTIFICATE_TEMPLATE_FILE = join(TEMPLATE_DIRECTORY, 'certificate.typ');
export const CERTIFICATE_FONTS_DIRECTORY = join(TEMPLATE_DIRECTORY, 'fonts');

const TEMPLATE_NAME = 'certificate.typ';
const CASE_NAME = 'case.json';
const PDF_NAME = 'certificate.pdf';

/** The signature's type is not one the upload accepts; nothing is rendered. */
export class UnsupportedSignatureType extends Error {
  constructor() {
    super('The signature copy is neither a PNG nor a JPEG.');
    this.name = 'UnsupportedSignatureType';
  }
}

/**
 * Writes the template, the case and the signature into `folder`, and answers the path of the
 * template there. The case's `signatureFile` is set here, from the signature handed in.
 */
export async function prepareCertificateFolder(
  folder: string,
  certificate: Omit<CertificateCase, 'signatureFile'>,
  signature: SignatureImage | null,
): Promise<string> {
  let signatureFile: string | null = null;
  if (signature !== null) {
    const name = SIGNATURE_FILE_OF[signature.contentType];
    if (name === undefined) throw new UnsupportedSignatureType();
    await writeFile(join(folder, name), signature.body);
    signatureFile = name;
  }
  const template = join(folder, TEMPLATE_NAME);
  await copyFile(CERTIFICATE_TEMPLATE_FILE, template);
  const data: CertificateCase = { ...certificate, signatureFile };
  await writeFile(join(folder, CASE_NAME), JSON.stringify(data), 'utf8');
  return template;
}

/** The CLI's arguments for one compile of `template` to `output`, the root its folder. */
export function compileArguments(folder: string, template: string, output: string): string[] {
  return [
    'compile',
    '--root',
    folder,
    '--font-path',
    CERTIFICATE_FONTS_DIRECTORY,
    '--ignore-system-fonts',
    template,
    output,
  ];
}

export interface RenderCertificatePdf {
  readonly run: TypstRunner;
  /** `TYPST_BIN`. */
  readonly bin: string;
  readonly certificate: Omit<CertificateCase, 'signatureFile'>;
  readonly signature: SignatureImage | null;
}

/** Renders one certificate and answers the PDF's bytes; the folder is gone when it settles. */
export async function renderCertificatePdf({
  run,
  bin,
  certificate,
  signature,
}: RenderCertificatePdf): Promise<Uint8Array> {
  const folder = await mkdtemp(join(tmpdir(), 'ijazah-certificate-'));
  try {
    const template = await prepareCertificateFolder(folder, certificate, signature);
    const output = join(folder, PDF_NAME);
    await run({ bin, args: compileArguments(folder, template, output) });
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
