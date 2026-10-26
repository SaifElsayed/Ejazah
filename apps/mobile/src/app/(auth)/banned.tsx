// T097: the `(auth)/banned` route, the banned state without a session, where a sign-up refused
// with `ACCOUNT_RESTRICTED` lands (FR-155).
import { BannedSignedOut } from '../../features/shared/account';

export default BannedSignedOut;
