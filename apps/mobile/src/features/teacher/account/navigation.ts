// T084: where the teacher's deletion leads. Back goes to the account tab when there is nothing to
// go back to (the boards' «رجوع» → TeacherAccount).
import { router } from 'expo-router';

export const DELETE_ACCOUNT_TEACHER_ROUTE = '/(teacher)/account/delete';

export function leaveToAccount(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(teacher)/(tabs)/account');
}
