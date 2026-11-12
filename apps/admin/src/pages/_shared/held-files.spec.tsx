// B42 lane S (T049, T050; spec FR-487; SRS FR-AUTH-14; T040's `disputes.heldFiles` and
// `disputes.heldFileLink`): a deleted party's held files inside an open dispute, case or complaint.
// The list is the server's metadata; each file opens through one signed link minted by its press,
// never before it and never kept for the next press. Each refusal T040 names in plain words.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { inBothLocales, mutation, query, refusal } from '../../test/app-harness';
import { HeldFilesSection } from './HeldFilesSection';
import { renderPiece } from './piece-harness';

const DISPUTE = '0193a6f0-0000-7000-8000-0000000000d7';
const OWNER = '0193a6f0-0000-7000-8000-0000000000b2';
const DOCUMENT = '0193a6f0-0000-7000-8000-0000000000c9';
const UPLOADED = '2026-10-03T08:30:00.000Z';
const PHOTO = { fileRef: `photo:${OWNER}`, kind: 'photo', ownerRole: 'teacher' } as const;
const ID_CARD = {
  fileRef: `document:${DOCUMENT}`,
  kind: 'national_id',
  ownerRole: 'teacher',
  uploadedAt: UPLOADED,
} as const;
const LINK = { url: 'https://files.example.test/signed/1', expiresAt: '2026-11-12T10:05:00.000Z' };
/** Lets anything a render started reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let opened: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
beforeEach(() => {
  opened = vi.fn<(...args: unknown[]) => void>();
  vi.spyOn(window, 'open').mockImplementation((...args: unknown[]) => {
    opened(...args);
    return null;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  setLocale('ar');
});

function fakeApi(files: readonly object[] = [PHOTO, ID_CARD]) {
  const api = { disputes: { heldFiles: query(), heldFileLink: mutation() } };
  api.disputes.heldFiles.query.mockResolvedValue({ files });
  return api;
}

function open(api = fakeApi()) {
  return { ...renderPiece(() => <HeldFilesSection disputeId={DISPUTE} />, api), api };
}

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

async function section(title = ar('admin.shared.heldFiles.title')) {
  const heading = await screen.findByRole('heading', { name: title });
  return within(heading.closest('section') as HTMLElement);
}

const viewButton = (box: Awaited<ReturnType<typeof section>>, file: MessageKey, owner: string) =>
  box.getByRole('button', {
    name: ar('admin.shared.heldFiles.viewFile', { file: ar(file), owner }),
  });

describe("a deleted party's held files (FR-487)", () => {
  it('lists each file by its kind, its owner and its upload, as the server answered, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const box = await section(t('admin.shared.heldFiles.title'));
        expect(await box.findByText(t('admin.shared.heldFiles.kind.photo'))).toBeTruthy();
        expect(box.getByText(t('admin.common.documentType.nationalId'))).toBeTruthy();
        expect(box.getAllByText(t('admin.shared.heldFiles.owner.teacher'))).toHaveLength(2);
        const uploaded = t('admin.shared.heldFiles.uploaded', {
          date: dayMonthYear(UPLOADED, locale, panelTimeZone()),
        });
        expect(box.getAllByText(uploaded, { exact: false })).toHaveLength(1);
        expect(
          box.getAllByRole('button', { name: new RegExp(t('admin.shared.heldFiles.view')) }),
        ).toHaveLength(2);
      },
    );
  });

  it('asks for no link until a file is pressed', async () => {
    const { api } = open();
    const box = await section();
    await box.findByText(ar('admin.shared.heldFiles.kind.photo'));
    await settle();
    expect(api.disputes.heldFiles.query).toHaveBeenCalledWith({ disputeId: DISPUTE });
    expect(api.disputes.heldFileLink.mutate).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('mints one link per press and opens it, never keeping one for the next press', async () => {
    const { api } = open();
    api.disputes.heldFileLink.mutate
      .mockResolvedValueOnce(LINK)
      .mockResolvedValueOnce({ ...LINK, url: 'https://files.example.test/signed/2' });
    const box = await section();
    await box.findByText(ar('admin.shared.heldFiles.kind.photo'));
    const view = viewButton(box, 'admin.common.documentType.nationalId', 'teacher');
    fireEvent.click(view);
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(api.disputes.heldFileLink.mutate).toHaveBeenCalledWith({
      disputeId: DISPUTE,
      fileRef: ID_CARD.fileRef,
    });
    expect(opened.mock.calls[0]?.[0]).toBe(LINK.url);
    await waitFor(() => expect((view as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(view);
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(api.disputes.heldFileLink.mutate).toHaveBeenCalledTimes(2);
    expect(opened.mock.calls[1]?.[0]).toBe('https://files.example.test/signed/2');
  });

  it('says an empty list in words', async () => {
    open(fakeApi([]));
    const box = await section();
    expect(await box.findByText(ar('admin.shared.heldFiles.empty'))).toBeTruthy();
  });

  it.each([
    [
      'NOT_FOUND',
      [{ path: 'cause', code: 'not_found' }],
      'admin.shared.heldFiles.refused.notFound',
    ],
    ['CONFLICT', [{ path: 'cause', code: 'not_open' }], 'admin.shared.heldFiles.refused.notOpen'],
    ['INTERNAL', [], 'admin.common.loadError.text'],
  ] as const)(
    'says a list refused %s in plain words, in both languages',
    async (code, details, words) => {
      await inBothLocales(
        () => {
          const api = fakeApi();
          api.disputes.heldFiles.query.mockRejectedValue(refusal(code, details));
          return open(api);
        },
        async (t) => {
          const box = await section(t('admin.shared.heldFiles.title'));
          expect(await box.findByText(t(words))).toBeTruthy();
        },
      );
    },
  );

  it.each([
    [
      'NOT_FOUND',
      [{ path: 'cause', code: 'not_held' }],
      'admin.shared.heldFiles.refused.fileNotFound',
    ],
    ['CONFLICT', [{ path: 'cause', code: 'not_open' }], 'admin.shared.heldFiles.refused.notOpen'],
    ['INTERNAL', [], 'admin.dialogs.submitError'],
  ] as const)(
    'says a link refused %s in plain words, opening nothing',
    async (code, details, words) => {
      const { api } = open();
      api.disputes.heldFileLink.mutate.mockRejectedValue(refusal(code, details));
      const box = await section();
      await box.findByText(ar('admin.shared.heldFiles.kind.photo'));
      fireEvent.click(viewButton(box, 'admin.shared.heldFiles.kind.photo', 'teacher'));
      expect(await box.findByText(ar(words))).toBeTruthy();
      expect(opened).not.toHaveBeenCalled();
    },
  );
});

describe('T058: RATE_LIMITED on the held files', () => {
  it('the list says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.disputes.heldFiles.query.mockRejectedValue(refusal('RATE_LIMITED'));
    open(api);
    const box = await section();
    expect(await box.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(box.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('a held file’s link says when to try again, opening nothing', async () => {
    const { api } = open();
    api.disputes.heldFileLink.mutate.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    const box = await section();
    await box.findByText(ar('admin.shared.heldFiles.kind.photo'));
    fireEvent.click(viewButton(box, 'admin.shared.heldFiles.kind.photo', 'teacher'));
    expect(await box.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(box.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
    expect(opened).not.toHaveBeenCalled();
  });
});
