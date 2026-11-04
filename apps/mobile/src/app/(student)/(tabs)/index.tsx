// T034 (FR-202), T074 (FR-137) and T050 (FR-390, FR-383, FR-384): the student's home, `Main` with
// the next session, which draws its empty state (`StudentHomeEmpty`) and its offline state
// (`MainOffline`) itself; the identity request's card first while the account is under one.
import { IdentityRequestCard } from '../../../features/shared/account';
import { Main } from '../../../features/student/home';

export default function StudentHome() {
  return <Main notice={<IdentityRequestCard />} />;
}
