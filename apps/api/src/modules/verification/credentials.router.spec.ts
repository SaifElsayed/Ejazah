// T057 — the `teacher.credentials` namespace as the user surface serves it (app-surface.md
// "`teacher.credentials` — after approval"; R-106, FR-153).
//
// Every procedure is the teacher kind. `list` admits an applicant (the credentials page is
// reachable from the status screen); `add`, `replaceDocument` and `documentLink` admit an approved
// teacher only, so an applicant is FORBIDDEN as a student is. An anonymous caller is
// UNAUTHENTICATED, a suspended or banned teacher ACCOUNT_RESTRICTED, which the phone's credentials
// pages (T059, B11b) rely on. The authorization gate (T028, R-MOBILE-13) reads these cases by
// path. What the service answers is credentials.service.spec.ts's.
import { beforeEach, describe, expect, it } from 'vitest';

import { CALLER, metaOf, recordingServices, surfaceOf } from './__fixtures__/surface.js';

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const CREDENTIAL = '0199d0a0-0000-7000-8000-0000000000e1';
const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d1';
const SUBJECT = '0199d0a0-0000-7000-8000-0000000000a1';

let services: ReturnType<typeof recordingServices>;
let surface: ReturnType<typeof surfaceOf>;
beforeEach(() => {
  services = recordingServices();
  surface = surfaceOf(services.verification);
});

function calls(caller: ReturnType<typeof surface.anonymous>) {
  return {
    'teacher.credentials.list': () => caller.teacher.credentials.list(),
    'teacher.credentials.add': () =>
      caller.teacher.credentials.add({ subjectId: SUBJECT, documentId: DOCUMENT }),
    'teacher.credentials.replaceDocument': () =>
      caller.teacher.credentials.replaceDocument({
        credentialId: CREDENTIAL,
        documentId: DOCUMENT,
      }),
    'teacher.credentials.documentLink': () =>
      caller.teacher.credentials.documentLink({ credentialId: CREDENTIAL }),
  };
}

const approvedOnly = [
  'teacher.credentials.add',
  'teacher.credentials.replaceDocument',
  'teacher.credentials.documentLink',
];

describe('the namespace', () => {
  it('declares every procedure as the teacher kind, none of them limited', () => {
    for (const path of Object.keys(calls(surface.anonymous()))) {
      expect(metaOf(path)).toEqual({ surface: 'app', caller: 'teacher' });
    }
  });

  it("refuses an anonymous caller UNAUTHENTICATED: 'teacher.credentials.list', 'teacher.credentials.add', 'teacher.credentials.replaceDocument', 'teacher.credentials.documentLink'", async () => {
    for (const [path, call] of Object.entries(calls(surface.anonymous()))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses a student FORBIDDEN: 'teacher.credentials.list', 'teacher.credentials.add', 'teacher.credentials.replaceDocument', 'teacher.credentials.documentLink'", async () => {
    for (const [path, call] of Object.entries(calls(surface.as('student')))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses an applicant FORBIDDEN where an approved teacher is required: 'teacher.credentials.add', 'teacher.credentials.replaceDocument', 'teacher.credentials.documentLink'", async () => {
    const all = calls(surface.as('applicant'));
    for (const path of approvedOnly) {
      await expect(all[path as keyof typeof all](), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    await all['teacher.credentials.list']();
    expect(services.calls).toEqual([['credentials.list', CALLER]]);
  });

  it('refuses a suspended or a banned teacher ACCOUNT_RESTRICTED: the phone’s credentials page (T059) is never reached', async () => {
    for (const standing of ['suspended applicant', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(calls(surface.as(standing)))) {
        await expect(call(), path).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(services.calls).toEqual([]);
  });

  it('admits an approved teacher to each, on the caller’s own id, and answers what the contract names', async () => {
    const caller = surface.as('approved');
    for (const call of Object.values(calls(caller))) await call();
    expect(services.calls).toEqual([
      ['credentials.list', CALLER],
      ['credentials.add', CALLER, { subjectId: SUBJECT, documentId: DOCUMENT }],
      ['credentials.replaceDocument', CALLER, { credentialId: CREDENTIAL, documentId: DOCUMENT }],
      ['credentials.documentLink', CALLER, { credentialId: CREDENTIAL }],
    ]);
    await expect(
      caller.teacher.credentials.documentLink({ credentialId: CREDENTIAL }),
    ).resolves.toEqual({
      url: 'https://storage.invalid/documents/one.pdf?signature=abc',
      expiresAt: '2026-10-21T09:05:00.000Z',
    });
  });
});
