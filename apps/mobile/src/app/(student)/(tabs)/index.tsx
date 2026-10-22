// T034 (FR-202): the student's home draws its empty state until the home lands in Phase 2; T074
// (FR-137): with the identity request's card while the account is under one.
import { IdentityRequestCard } from '../../../features/shared/account';
import { StudentHomeEmpty } from '../../../features/student/home';

export default function StudentHome() {
  return <StudentHomeEmpty notice={<IdentityRequestCard />} />;
}
