// 005:T019 (FR-601): the teacher's signature screen, in both languages. With none held it draws the
// empty pad and «رفع التوقيع»; with one held, its image by the signed link `teacher.signature.get`
// answers and «استبدال الصورة»; a picked image is uploaded (`POST /uploads/signature`) and the
// signature read again; a refused upload is said: a refused image in its own words, any other
// refusal as the generic failure.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import type { Direction } from '../../../lib/direction';
import { ApiRefusal } from '../../../lib/client';
import { fakeApi, type Procedure } from '../../shared/__tests__/api-double';
import { TeacherSignature } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ router: { back: () => mockBack() } }));
const mockPick = jest.fn<() => Promise<unknown>>();
jest.mock('../../../lib/files', () => ({ pickPhoto: () => mockPick() }));

const HELD = 'https://files.ijazah.test/signatures/old.png?signature=0';
const NEW = 'https://files.ijazah.test/signatures/new.png?signature=1';
const PICKED = { uri: 'file:///cache/signature.png', name: 'signature.png', mimeType: 'image/png' };

const said = (direction: Direction, key: MessageKey) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key);

let get: Procedure;
let upload: jest.Mock<(file: unknown) => Promise<unknown>>;
let queries: QueryClient;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <TeacherSignature />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  get = jest.fn(async (): Promise<unknown> => ({ link: null, uploadedAt: null }));
  Object.assign(mockApi.api.teacher, { signature: { get: { query: get } } });
  upload = jest.fn(async (): Promise<unknown> => ({ uploadedAt: '2026-11-18T10:00:00.000Z' }));
  Object.assign(mockApi.value.client, { uploadSignature: upload });
  mockPick.mockReset();
  mockPick.mockResolvedValue(PICKED);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('TeacherSignature (FR-601)', () => {
  it('draws none: the empty pad and «رفع التوقيع», no image', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'teacher.signature.emptyPad'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.signature.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.signature.upload'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.signature.replaceImage'))).toBeNull();
      expect(screen.queryByLabelText(said(direction, 'teacher.signature.a11y.preview'))).toBeNull();
    });
  });

  it('draws the one held by its signed link, with «استبدال الصورة»', async () => {
    get.mockResolvedValue({ link: HELD, uploadedAt: '2026-11-01T10:00:00.000Z' });
    await inBothDirections(ui, async (_rendered, direction) => {
      const image = await screen.findByLabelText(said(direction, 'teacher.signature.a11y.preview'));
      expect(image.props.source).toEqual({ uri: HELD });
      expect(screen.getByText(said(direction, 'teacher.signature.replaceImage'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'teacher.signature.emptyPad'))).toBeNull();
    });
  });

  it('replaces it: the picked image uploaded, then the signature read again and drawn', async () => {
    get
      .mockResolvedValueOnce({ link: HELD, uploadedAt: '2026-11-01T10:00:00.000Z' })
      .mockResolvedValue({ link: NEW, uploadedAt: '2026-11-18T10:00:00.000Z' });
    await renderIn('rtl', ui());
    await fireEvent.press(
      await screen.findByText(translate('ar', 'teacher.signature.replaceImage')),
    );
    await waitFor(() => expect(upload).toHaveBeenCalledWith(PICKED));
    const image = await screen.findByLabelText(translate('ar', 'teacher.signature.a11y.preview'));
    await waitFor(() => expect(image.props.source).toEqual({ uri: NEW }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('uploads the first one from none', async () => {
    get
      .mockResolvedValueOnce({ link: null, uploadedAt: null })
      .mockResolvedValue({ link: NEW, uploadedAt: '2026-11-18T10:00:00.000Z' });
    await renderIn('ltr', ui());
    await fireEvent.press(await screen.findByText(translate('en', 'teacher.signature.upload')));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(PICKED));
    expect(
      await screen.findByLabelText(translate('en', 'teacher.signature.a11y.preview')),
    ).toBeTruthy();
  });

  it('says a refused image in its own words, and any other refusal as the generic failure', async () => {
    upload.mockRejectedValueOnce(
      new ApiRefusal({ error: { code: 'VALIDATION_FAILED', message: 'refused' } }),
    );
    upload.mockRejectedValueOnce(new ApiRefusal({ error: { code: 'FORBIDDEN', message: 'no' } }));
    for (const direction of ['rtl', 'ltr'] as const) {
      const rendered = await renderIn(direction, ui());
      await fireEvent.press(await screen.findByText(said(direction, 'teacher.signature.upload')));
      const words = direction === 'rtl' ? 'teacher.signature.refused' : 'common.state.actionError';
      expect(await screen.findByText(said(direction, words))).toBeTruthy();
      await rendered.unmount();
    }
    expect(get).toHaveBeenCalledTimes(2);
  });
});
