// T021 of specs/005-certification (FR-611, FR-614): the report and flag sheet both roles open from a
// session, the chat and a teacher's profile (R-MOBILE-3), and what it names and sends.
export { type FileReport, reportRefusal, useFileReport } from './api';
export { ReportEntry } from './components/ReportEntry';
export { ReportSheet } from './components/ReportSheet';
export {
  REPORT_WORDS,
  type ReportPlace,
  type ReportReason,
  type ReportTarget,
  reportTextOf,
  type ReportWords,
} from './reasons';
