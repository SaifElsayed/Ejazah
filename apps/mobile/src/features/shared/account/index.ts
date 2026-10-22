// T052: what the student's and the teacher's account tabs share (screens.md §8 and §16). T074: the
// restricted screen, the identity request and the card a home shows while one is open.
export {
  AccountFailed,
  AccountLoading,
  AccountSettings,
  initialsOf,
} from './components/AccountSettings';
export { IdentityRequestCard } from './components/IdentityRequestCard';
export { AccountRestricted, Restricted, TeacherRestricted } from './components/Restricted';
export { SignOutSheet } from './components/SignOutSheet';
export { VerifyIdentity } from './components/VerifyIdentity';
export { useAccountActions } from './hooks';
export { IDENTITY_REQUEST_QUERY_KEY, useIdentityRequest } from './identity';
