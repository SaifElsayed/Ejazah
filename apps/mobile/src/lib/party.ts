// T007 (`003:T090`; FR-426): the other party of an enrollment as the lists draw them. A deleted
// account has no name (FR-141 erased it): the server answers `displayNameOrNull: null` with
// `deleted: true`, and the phone draws the role word ADR 0015 names, «معلم محذوف» or «طالب محذوف»,
// never an empty line. The deprecated `displayName` is not read (the note under T007 of
// specs/004-sessions/tasks.md).
import type { ListedPartyName } from '@ijazah/contracts';

import { type MessageKey, useT } from '../i18n';

/** Which party the name is of, for the stand-in's role word. */
export type PartyRole = 'teacher' | 'student';

const STAND_IN: Readonly<Record<PartyRole, MessageKey>> = {
  teacher: 'common.party.deletedTeacher',
  student: 'common.party.deletedStudent',
};

type NamedParty = Pick<ListedPartyName, 'displayNameOrNull' | 'deleted'>;

/** The party's name, or the stand-in for a deleted one, in the page's language. */
export function usePartyName(): (party: NamedParty, role: PartyRole) => string {
  const t = useT();
  return (party, role) =>
    party.deleted || party.displayNameOrNull === null ? t(STAND_IN[role]) : party.displayNameOrNull;
}

/** What an avatar's letters are taken from: the name, nothing for a deleted party. */
export function avatarNameOf(party: NamedParty): string {
  return party.deleted ? '' : (party.displayNameOrNull ?? '');
}
