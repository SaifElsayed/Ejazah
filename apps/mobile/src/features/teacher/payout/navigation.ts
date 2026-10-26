// T078: where the payout screens lead. The payout route draws the screen of the state; `start` is
// `PayoutStart` again, for a replacement or a retry (FR-193). Back goes to the account tab when
// there is nothing to go back to (the boards' «رجوع» → TeacherAccount, even from the approved
// screen, which replaces itself).
import { router } from 'expo-router';

export const PAYOUT_ROUTE = '/(teacher)/payout';
export const PAYOUT_START_ROUTE = '/(teacher)/payout/start';

export function leavePayout(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(teacher)/(tabs)/account');
}
