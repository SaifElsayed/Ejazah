// B42 lane S (FR-426; T047, T049, T050, T058): a party of an enrollment as the server answered it
// (`Party`, admin-surface.md: `{ userId, displayName | null, deleted }`). A deleted account has no
// name, so it reads a stand-in by its role in the enrollment, the phone's words (`common.party.*`),
// never an empty name. The page decides where the name links.
import type { MonitorParty } from '@ijazah/contracts/admin';

import { type MessageKey, type MessageValues, useT } from '../../i18n';
import { UserText } from '../../i18n/UserText';

export type PartyRole = 'student' | 'teacher';

const STAND_IN: Readonly<Record<PartyRole, MessageKey>> = {
  student: 'admin.shared.party.deletedStudent',
  teacher: 'admin.shared.party.deletedTeacher',
};

/** The party's name, or its stand-in when deleted, as text (a link's label, a table's cell). */
export function partyLabel(
  party: MonitorParty,
  role: PartyRole,
  t: (key: MessageKey, values?: MessageValues) => string,
): string {
  return party.deleted || party.displayName === null ? t(STAND_IN[role]) : party.displayName;
}

/** The party's name, isolated for direction, or its stand-in, muted, when deleted. */
export function PartyName({
  party,
  role,
}: {
  readonly party: MonitorParty;
  readonly role: PartyRole;
}) {
  const t = useT();
  if (party.deleted || party.displayName === null) {
    return <span className="tone-muted">{t(STAND_IN[role])}</span>;
  }
  return <UserText>{party.displayName}</UserText>;
}
