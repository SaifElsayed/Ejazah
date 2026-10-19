// T034: the account tab's frame until T052 (B10) draws the account itself: the header only, so the
// tab bar's fifth route exists from this batch.
import { AppHeader } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';

export function StudentAccountShell() {
  const t = useT();
  return <TabScreen header={<AppHeader title={t('student.tabs.account')} />}>{null}</TabScreen>;
}
