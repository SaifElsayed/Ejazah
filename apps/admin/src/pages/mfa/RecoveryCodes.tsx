// T070, shared since T073: the recovery codes, shown once (`AdminMfaSetup`'s third step, and the
// codes an administrator regenerates on their own account): the list, to copy or download as a text
// file, and «حفظت الرموز», which the caller's next step waits for.
import { Button, CheckRow } from '../../design/components';
import { useT } from '../../i18n';

/** The name of the downloaded codes. */
export const RECOVERY_CODES_FILE = 'ijazah-admin-recovery-codes.txt';

export function RecoveryCodes({
  codes,
  saved,
  onSaved,
}: {
  readonly codes: readonly string[];
  readonly saved: boolean;
  readonly onSaved: (saved: boolean) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="card card--surface">
        <ul className="grid-2 gap-3" aria-label={t('admin.mfaSetup.step3.a11y.codes')}>
          {codes.map((recovery) => (
            <li key={recovery} className="text-latin text-medium ltr">
              {recovery}
            </li>
          ))}
        </ul>
      </div>
      <div className="row gap-2">
        <Button
          label={t('admin.mfaSetup.step3.copy')}
          variant="secondary"
          layout="grow"
          icon={{ name: 'copy' }}
          onPress={() => copy(codes.join('\n'))}
        />
        <Button
          label={t('admin.mfaSetup.step3.download')}
          variant="secondary"
          layout="grow"
          icon={{ name: 'download' }}
          onPress={() => download(codes)}
        />
      </div>
      <CheckRow label={t('admin.mfaSetup.step3.savedConfirm')} checked={saved} onChange={onSaved} />
    </>
  );
}

function copy(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

/** Saves the codes as a text file, one a line (a file the browser writes, nothing sent). */
function download(codes: readonly string[]): void {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = RECOVERY_CODES_FILE;
  link.click();
  // Let go of the address once the browser took the download: Safari cancels it otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
