// T040 of specs/004-sessions (spec FR-487, FR-480; research R-327, «The administrator's read»;
// contracts/admin-surface.md, `disputes.heldFiles` and `disputes.heldFileLink`) — the two procedures
// as they are served: `disputes.heldFiles` audited `dispute.held_files_listed` on the dispute, one
// entry per list; `disputes.heldFileLink` audited `held_file.view` on the dispute with the `fileRef`
// in `after`, one entry per link, as `documents.link` records `document.view`; the list's output
// schema admitting no link and no key; each refused to an anonymous caller and an unverified second
// factor, reaching and writing nothing; a service's refusal (`CONFLICT` once the dispute is not
// open, `NOT_FOUND`) rolling its audit entry back. What each does is
// `dispute-matter.service.spec.ts`' and `tests/db-integrity/dispute-held-files.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { disputesAdminRouter } from './disputes-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ disputes: disputesAdminRouter }));

const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const CLOSED = '0199d0a0-0000-7000-8000-0000000000d2';
const STUDENT = '0199d0a0-0000-7000-8000-000000000901';
const DOCUMENT = '0199d0a0-0000-7000-8000-000000000a01';
const FILES = {
  files: [
    { fileRef: `photo:${STUDENT}`, kind: 'photo' as const, ownerRole: 'student' as const },
    {
      fileRef: `document:${DOCUMENT}`,
      kind: 'credential' as const,
      ownerRole: 'student' as const,
      uploadedAt: '2026-10-01T08:30:00.000Z',
    },
  ],
};
const LINK = { url: 'https://storage.invalid/signed', expiresAt: '2026-11-11T09:05:00.000Z' };

function surface(listed: unknown = FILES) {
  const reached: unknown[][] = [];
  const closed = () =>
    new DomainError('CONFLICT', undefined, { details: [{ path: 'cause', code: 'not_open' }] });
  const contexts = adminContextsOver({
    disputes: {
      ...unusedAdminServices.disputes,
      heldFiles: async (_tx, adminId, input) => {
        reached.push(['heldFiles', adminId, input]);
        if (input.disputeId === CLOSED) throw closed();
        return listed as typeof FILES;
      },
      heldFileLink: async (_tx, adminId, input) => {
        reached.push(['heldFileLink', adminId, input]);
        if (input.disputeId === CLOSED) throw closed();
        if (input.fileRef !== `document:${DOCUMENT}`) throw new DomainError('NOT_FOUND');
        return LINK;
      },
    },
  });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('disputes.heldFiles (FR-487)', () => {
  it('answers the metadata and audits dispute.held_files_listed on the dispute, one entry per list', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).disputes.heldFiles({ disputeId: DISPUTE })).toEqual(FILES);
    expect(await as(VERIFIED).disputes.heldFiles({ disputeId: DISPUTE })).toEqual(FILES);
    expect(reached).toEqual([
      ['heldFiles', SPEC_ADMIN, { disputeId: DISPUTE }],
      ['heldFiles', SPEC_ADMIN, { disputeId: DISPUTE }],
    ]);
    const entry = {
      adminId: SPEC_ADMIN,
      action: 'dispute.held_files_listed',
      targetType: 'dispute',
      targetId: DISPUTE,
    };
    expect(written).toEqual([entry, entry]);
  });

  it.each([
    ['a link', { url: LINK.url }],
    ['a storage key', { storageKey: 'documents/x.pdf' }],
  ])('the output schema strips %s a file might carry', async (_name, extra) => {
    const { as } = surface({ files: [{ ...FILES.files[0], ...extra }] });
    const { files } = await as(VERIFIED).disputes.heldFiles({ disputeId: DISPUTE });
    expect(files).toEqual([FILES.files[0]]);
  });

  it('answers nothing for a reference that is a storage key, not a document or a photo id', async () => {
    const { as } = surface({
      files: [{ ...FILES.files[0], fileRef: 'photos/0199d0a0.jpg' }],
    });
    expect(await codeOf(as(VERIFIED).disputes.heldFiles({ disputeId: DISPUTE }))).toBe('INTERNAL');
  });

  it('once the dispute is not open: CONFLICT, nothing audited', async () => {
    const { as, written } = surface();
    expect(await codeOf(as(VERIFIED).disputes.heldFiles({ disputeId: CLOSED }))).toBe('CONFLICT');
    expect(written).toEqual([]);
  });

  it.each([
    ['an anonymous caller', null, 'UNAUTHENTICATED'],
    ['an unverified second factor', { ...VERIFIED, mfaVerified: false }, 'MFA_REQUIRED'],
  ] as const)('%s is refused, reaching and writing nothing', async (_name, session, code) => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(session).disputes.heldFiles({ disputeId: DISPUTE }))).toBe(code);
    expect(reached).toEqual([]);
    expect(written).toEqual([]);
  });
});

describe('disputes.heldFileLink (FR-487)', () => {
  it('answers one link per press, each audited held_file.view on the dispute with the fileRef', async () => {
    const { as, written } = surface();
    const input = { disputeId: DISPUTE, fileRef: `document:${DOCUMENT}` };
    expect(await as(VERIFIED).disputes.heldFileLink(input)).toEqual(LINK);
    expect(await as(VERIFIED).disputes.heldFileLink(input)).toEqual(LINK);
    const entry = {
      adminId: SPEC_ADMIN,
      action: 'held_file.view',
      targetType: 'dispute',
      targetId: DISPUTE,
      after: { fileRef: `document:${DOCUMENT}` },
    };
    expect(written).toEqual([entry, entry]);
  });

  it.each([
    ['a reference of neither form', 'not-a-reference'],
    ['a live person’s photo', `photo:${STUDENT}`],
  ])('%s is NOT_FOUND, nothing audited', async (_name, fileRef) => {
    const { as, written } = surface();
    expect(await codeOf(as(VERIFIED).disputes.heldFileLink({ disputeId: DISPUTE, fileRef }))).toBe(
      'NOT_FOUND',
    );
    expect(written).toEqual([]);
  });

  it('once the dispute is not open: CONFLICT, nothing audited', async () => {
    const { as, written } = surface();
    expect(
      await codeOf(
        as(VERIFIED).disputes.heldFileLink({ disputeId: CLOSED, fileRef: `document:${DOCUMENT}` }),
      ),
    ).toBe('CONFLICT');
    expect(written).toEqual([]);
  });

  it('an empty reference, or one past its bound, is refused by the input schema, reaching nothing', async () => {
    const { as, reached } = surface();
    for (const fileRef of ['', 'x'.repeat(101)]) {
      expect(
        await codeOf(as(VERIFIED).disputes.heldFileLink({ disputeId: DISPUTE, fileRef })),
      ).toBe('VALIDATION_FAILED');
    }
    expect(reached).toEqual([]);
  });

  it.each([
    ['an anonymous caller', null, 'UNAUTHENTICATED'],
    ['an unverified second factor', { ...VERIFIED, mfaVerified: false }, 'MFA_REQUIRED'],
  ] as const)('%s is refused, reaching and writing nothing', async (_name, session, code) => {
    const { as, written, reached } = surface();
    expect(
      await codeOf(
        as(session).disputes.heldFileLink({ disputeId: DISPUTE, fileRef: `document:${DOCUMENT}` }),
      ),
    ).toBe(code);
    expect(reached).toEqual([]);
    expect(written).toEqual([]);
  });
});
