// T084: where the account's pushed screens lead. Back goes to the account tab when there is
// nothing to go back to (the boards' «رجوع» → StudentAccount).
import { router } from 'expo-router';

export const PROFILE_EDITOR_ROUTE = '/(student)/account/profile';
export const DELETE_ACCOUNT_ROUTE = '/(student)/account/delete';

export function leaveToAccount(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(student)/(tabs)/account');
}
