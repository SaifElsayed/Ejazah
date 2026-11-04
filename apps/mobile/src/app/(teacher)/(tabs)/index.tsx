// T034 (FR-202), T051 (FR-391, FR-393): the teacher's day, read by `teacher.today`; T074 (FR-137):
// with the identity request's card while the account is under one.
import { IdentityRequestCard } from '../../../features/shared/account';
import { TeacherHome } from '../../../features/teacher/home';

export default function TeacherHomeRoute() {
  return <TeacherHome notice={<IdentityRequestCard />} />;
}
