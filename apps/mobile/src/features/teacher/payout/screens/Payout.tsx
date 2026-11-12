// T078 (FR-190 to FR-194): the payout route draws the screen of the state `teacher.payout.get`
// answers: not configured, `PayoutStart`; pending, `PayoutSetup`; verified, `PayoutVerified`;
// rejected, `PayoutRejected`. The approved screen, the account's row and the packages' banner all
// lead here, so each lands on the state the server holds.
import { Skeleton } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { usePayout } from '../api';
import { PayoutHeader } from '../components/PayoutHeader';
import { PayoutRejected } from './PayoutRejected';
import { PayoutSetup } from './PayoutSetup';
import { PayoutStart } from './PayoutStart';
import { PayoutVerified } from './PayoutVerified';

export function Payout() {
  const t = useT();
  const payout = usePayout();
  const answer = payout.data;
  if (answer === undefined) {
    return (
      <StackScreen header={<PayoutHeader title={t('teacher.payout.start.title')} />}>
        <NotLoaded
          failed={payout.isError}
          error={payout.error}
          onRetry={() => void payout.refetch()}
          loading={<Skeleton shape="block" />}
        />
      </StackScreen>
    );
  }
  if (answer.state === 'not_configured') return <PayoutStart />;
  if (answer.state === 'pending_verification') return <PayoutSetup payout={answer} />;
  if (answer.state === 'verified') return <PayoutVerified payout={answer} />;
  return <PayoutRejected payout={answer} />;
}
