// B42 lane S (FR-451; T047, T049, T050, T058): an enrollment's Teacher-No-Show count and its
// repeated-absence mark, both as the server answered them. The mark is the server's `repeatedAbsence`,
// never a threshold of the panel's, and nothing follows from it; the board's «{count} of {threshold}
// before termination» (`admin.disputes.detail.noShowCountValue`) is never said (ADR 0023).
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '../../i18n';
import { inBothLocales } from '../../test/app-harness';
import { NoShowMark } from './NoShowMark';
import { renderPiece } from './piece-harness';

afterEach(() => setLocale('ar'));

const draw = (teacherNoShows: number, repeatedAbsence: boolean) => () =>
  renderPiece(
    () => <NoShowMark teacherNoShows={teacherNoShows} repeatedAbsence={repeatedAbsence} />,
    {},
  );

describe("an enrollment's Teacher-No-Show count and mark (FR-451)", () => {
  it('shows the count the server answered, in both languages', async () => {
    await inBothLocales(draw(3, false), (t) => {
      expect(screen.getByText(t('admin.shared.noShows.count', { count: 3 }))).toBeTruthy();
    });
  });

  it('shows the mark when the server answers it, whatever the count', async () => {
    await inBothLocales(draw(1, true), (t) => {
      expect(screen.getByText(t('admin.shared.noShows.count', { count: 1 }))).toBeTruthy();
      expect(screen.getByText(t('admin.shared.noShows.mark'))).toBeTruthy();
    });
  });

  it('shows no mark the server did not answer, whatever the count', async () => {
    await inBothLocales(draw(9, false), (t) => {
      expect(screen.getByText(t('admin.shared.noShows.count', { count: 9 }))).toBeTruthy();
      expect(screen.queryByText(t('admin.shared.noShows.mark'))).toBeNull();
    });
  });

  it('never says a threshold or a termination', async () => {
    await inBothLocales(draw(5, true), (t) => {
      expect(screen.getByText(t('admin.shared.noShows.mark'))).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/قبل الإنهاء|before termination/i);
    });
  });
});
