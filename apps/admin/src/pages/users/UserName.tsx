// B42, T058 (FR-426): a user's name, or its stand-in when deleted. A user with a role reads lane S's
// stand-in for that role (`PartyName`, `partyLabel`); one with no role (an account without its
// `user_roles` row, the follow-up under T058, (2)) reads the account's own stand-in, never an empty
// name.
import { type MessageKey, type MessageValues, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';
import { partyLabel, PartyName } from '../_shared';
import type { Role } from './words';

interface Named {
  readonly userId: string;
  readonly displayName: string | null;
  readonly deleted: boolean;
}

export function UserName({ user, role }: { readonly user: Named; readonly role: Role | null }) {
  const t = useT();
  if (role !== null) return <PartyName party={user} role={role} />;
  if (user.deleted || user.displayName === null) {
    return <span className="tone-muted">{t('admin.users.directory.deletedAccount')}</span>;
  }
  return <UserText>{user.displayName}</UserText>;
}

/** The user's name as text, or its stand-in (a heading, a dialog's title). */
export function userLabel(
  user: Named,
  role: Role | null,
  t: (key: MessageKey, values?: MessageValues) => string,
): string {
  if (role !== null) return partyLabel(user, role, t);
  return user.deleted || user.displayName === null
    ? t('admin.users.directory.deletedAccount')
    : user.displayName;
}
