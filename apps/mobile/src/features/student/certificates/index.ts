// T020 of specs/005-certification: the student's certificates, their list and the opening of one
// (FR-607; R-HONEST-6), which the enrollment's ijazah request shares.
export {
  CERTIFICATES_QUERY_KEY,
  type CertificateState,
  certificateStateOf,
  certificatesOfEnrollmentQueryKey,
  useCertificates,
  useOpenCertificate,
} from './api';
export { Certificates } from './screens/Certificates';
