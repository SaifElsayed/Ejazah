// PUBLIC ENTRY of the certification module (T017). Other modules import this file and nothing below it (R-API-3).
export {};

// 005:T008 (B46, lane B; Q-B1 (a), the owner's word of 2026-11-17): the certificate's rendering,
// for the worker's `render-certificate` job. The render store over `ijazahs` and `ijazah_requests`
// (the source read outside a transaction, the mark on the job's transaction under the ijazah's
// lock), and the template's case and its one render call through the kernel's Typst runner.
export {
  type MarkOutcome,
  markRendered,
  type RenderedMark,
  type RenderSource,
  renderSourceOf,
} from './certificate-render.repository.js';
export {
  type CertificateCase,
  type CertificateGender,
  type CertificateLanguage,
  type PrintedDate,
  renderCertificatePdf,
  type SignatureImage,
  UnsupportedSignatureType,
} from './template/certificate-case.js';
