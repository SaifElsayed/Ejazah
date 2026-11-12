// T045 of specs/004-sessions (FR-489, FR-490): the chat's picker asks the system for one PDF or text
// document, and hands back where it is, its name and the type the device reported; a cancel is
// nothing. The server decides the type again by content (never trusting this one).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { pickChatDocument } from './pick';

const mockGetDocument = jest.fn<(options: unknown) => Promise<unknown>>();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (options: unknown) => mockGetDocument(options),
}));

beforeEach(() => {
  mockGetDocument.mockReset();
});

describe('pickChatDocument (T045)', () => {
  it('asks for one PDF or text document and hands back its place, its name and its type', async () => {
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/notes.txt', name: 'ملاحظات.txt', mimeType: 'text/plain' }],
    });
    await expect(pickChatDocument()).resolves.toEqual({
      uri: 'file:///cache/notes.txt',
      name: 'ملاحظات.txt',
      mimeType: 'text/plain',
    });
    expect(mockGetDocument).toHaveBeenCalledWith({
      type: ['application/pdf', 'text/plain'],
      copyToCacheDirectory: true,
      multiple: false,
    });
  });

  it('is nothing when the person cancels', async () => {
    mockGetDocument.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickChatDocument()).resolves.toBeNull();
  });
});
