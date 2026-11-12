// B42 lane S (FR-426; T047, T049, T050, T058): a party named by the server's answer, a deleted one
// by its stand-in, never by an empty name.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale, translate } from '../../i18n';
import { inBothLocales } from '../../test/app-harness';
import { partyLabel, PartyName, type PartyRole } from './PartyName';
import { renderPiece } from './piece-harness';

afterEach(() => setLocale('ar'));

const LIVE = {
  userId: '0193a6f0-0000-7000-8000-0000000000b1',
  displayName: 'Huda Kamal',
  deleted: false,
};
const GONE = { userId: '0193a6f0-0000-7000-8000-0000000000b2', displayName: null, deleted: true };

const STAND_IN = {
  student: 'admin.shared.party.deletedStudent',
  teacher: 'admin.shared.party.deletedTeacher',
} as const;

describe('a party of an enrollment (FR-426)', () => {
  it.each(['student', 'teacher'] as const)(
    "names a live %s by the server's name, never the stand-in, in both languages",
    async (role: PartyRole) => {
      await inBothLocales(
        () => renderPiece(() => <PartyName party={LIVE} role={role} />, {}),
        (t) => {
          expect(screen.getByText(LIVE.displayName)).toBeTruthy();
          expect(screen.queryByText(t(STAND_IN[role]))).toBeNull();
        },
      );
    },
  );

  it.each(['student', 'teacher'] as const)(
    'names a deleted %s by its stand-in, never an empty name, in both languages',
    async (role: PartyRole) => {
      await inBothLocales(
        () => renderPiece(() => <PartyName party={GONE} role={role} />, {}),
        (t, locale) => {
          const standIn = screen.getByText(t(STAND_IN[role]));
          expect(standIn.textContent).toBe(translate(locale, STAND_IN[role]));
        },
      );
    },
  );

  it('answers the same words as text, for a link or a cell', () => {
    const t = (key: Parameters<typeof translate>[1]) => translate('en', key);
    expect(partyLabel(LIVE, 'student', t)).toBe('Huda Kamal');
    expect(partyLabel(GONE, 'student', t)).toBe('Deleted student');
    expect(partyLabel(GONE, 'teacher', t)).toBe('Deleted teacher');
  });
});
