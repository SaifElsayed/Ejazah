// T078: the payout screens' nav header, whose back leads to the account tab when there is nothing
// to go back to.
import { NavHeader } from '../../../../design/primitives';
import { leavePayout } from '../navigation';

export function PayoutHeader({ title }: { readonly title: string }) {
  return <NavHeader title={title} back={{ kind: 'back', onPress: leavePayout }} />;
}
