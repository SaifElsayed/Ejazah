// T034 (FR-202): the teacher's day draws its empty state until the day lands in Phase 2; T074
// (FR-137): with the identity request's card while the account is under one.
import { IdentityRequestCard } from '../../../features/shared/account';
import { TeacherHomeEmpty } from '../../../features/teacher/home';

export default function TeacherHome() {
  return <TeacherHomeEmpty notice={<IdentityRequestCard />} />;
}
