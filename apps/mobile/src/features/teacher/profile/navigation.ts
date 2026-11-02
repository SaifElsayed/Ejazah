// T158: where the public profile is reached from and leads. Back goes to the account tab when there
// is nothing to go back to (the board's «رجوع» and «حفظ» → TeacherAccount).
import { router } from 'expo-router';

export const PROFILE_ROUTE = '/(teacher)/profile';

export function leaveToAccount(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(teacher)/(tabs)/account');
}
