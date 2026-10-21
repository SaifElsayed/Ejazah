// T058 (FR-152): `ApplicationApproved` is shown once, on the first launch after the approval. An
// approved teacher lands on the tabs (`account.me`'s landing), so the tabs' layout holds this: it
// reads the application while the account says it is approved and, until the approved screen has
// been shown (`approvedShown`), opens it. Nothing is drawn.
import { Redirect } from 'expo-router';

import { useMe } from '../../../../lib/account';
import { useApplicationStatus } from '../api';

export function ApprovedOnce() {
  const me = useMe();
  const approved = me.data?.teacher?.applicationStatus === 'approved';
  const application = useApplicationStatus(approved);
  if (!approved || application.data?.approvedShown !== false) return null;
  return <Redirect href="/(teacher)/application/status" />;
}
