// T056 — the `teacher.application` namespace as the user surface serves it (app-surface.md
// "`teacher.application` — applying"; R-106, FR-137).
//
// Every procedure is the teacher kind admitting an applicant: an anonymous caller is refused
// (UNAUTHENTICATED), a student (FORBIDDEN), a suspended or banned teacher (ACCOUNT_RESTRICTED); an
// applicant and an approved teacher reach the service with their own id and nothing the client
// said about who they are. The authorization gate (T028, R-MOBILE-13) reads these cases by path.
// What the service answers is application.service.spec.ts's.
import { beforeEach, describe, expect, it } from 'vitest';

import { CALLER, metaOf, recordingServices, surfaceOf } from './__fixtures__/surface.js';

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const SUBJECT = '0199d0a0-0000-7000-8000-0000000000a1';
const application = {
  subjectIds: [SUBJECT],
  qualificationSummary: 'إجازة في حفظ القرآن',
  identityDocument: {
    type: 'passport' as const,
    documentId: '0199d0a0-0000-7000-8000-0000000000d1',
  },
  credentials: [{ subjectId: SUBJECT, documentId: '0199d0a0-0000-7000-8000-0000000000d2' }],
};
const submit = { ...application, idempotencyKey: 'apply-0199d0a0-0000-7000-8000' };
const resubmit = { identityDocumentId: '0199d0a0-0000-7000-8000-0000000000d3' };

let services: ReturnType<typeof recordingServices>;
let surface: ReturnType<typeof surfaceOf>;
beforeEach(() => {
  services = recordingServices();
  surface = surfaceOf(services.verification);
});

/** Each procedure of the namespace, called by `caller`. */
function calls(caller: ReturnType<typeof surface.anonymous>) {
  return {
    'teacher.application.get': () => caller.teacher.application.get(),
    'teacher.application.submit': () => caller.teacher.application.submit(submit),
    'teacher.application.resubmit': () => caller.teacher.application.resubmit(resubmit),
    'teacher.application.reapply': () => caller.teacher.application.reapply(application),
    'teacher.application.markApprovedShown': () => caller.teacher.application.markApprovedShown(),
  };
}

describe('the namespace', () => {
  it('declares every procedure as the teacher kind, none of them limited', () => {
    for (const path of Object.keys(calls(surface.anonymous()))) {
      expect(metaOf(path)).toEqual({ surface: 'app', caller: 'teacher' });
    }
  });

  it("refuses an anonymous caller UNAUTHENTICATED: 'teacher.application.get', 'teacher.application.submit', 'teacher.application.resubmit', 'teacher.application.reapply', 'teacher.application.markApprovedShown'", async () => {
    for (const [path, call] of Object.entries(calls(surface.anonymous()))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses a student FORBIDDEN: 'teacher.application.get', 'teacher.application.submit', 'teacher.application.resubmit', 'teacher.application.reapply', 'teacher.application.markApprovedShown'", async () => {
    for (const [path, call] of Object.entries(calls(surface.as('student')))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(services.calls).toEqual([]);
  });

  it('refuses a suspended or a banned teacher ACCOUNT_RESTRICTED: the restricted screen answers them', async () => {
    for (const standing of ['suspended applicant', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(calls(surface.as(standing)))) {
        await expect(call(), path).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(services.calls).toEqual([]);
  });

  it('admits an applicant and an approved teacher, each call on the caller’s own id', async () => {
    for (const standing of ['applicant', 'approved'] as const) {
      for (const call of Object.values(calls(surface.as(standing)))) await call();
    }
    const names = [
      'application.get',
      'application.submit',
      'application.resubmit',
      'application.reapply',
      'application.markApprovedShown',
    ];
    expect(services.calls.map(([name, userId]) => [name, userId])).toEqual(
      [...names, ...names].map((name) => [name, CALLER]),
    );
  });

  it('hands the service the validated input, the key with it on submit', async () => {
    const caller = surface.as('applicant');
    await caller.teacher.application.submit(submit);
    await caller.teacher.application.reapply(application);
    expect(services.calls).toEqual([
      ['application.submit', CALLER, submit],
      ['application.reapply', CALLER, application],
    ]);
  });

  it('refuses an input outside the contract before the service is reached (BAD_REQUEST)', async () => {
    const caller = surface.as('applicant');
    await expect(
      caller.teacher.application.submit({ ...submit, subjectIds: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.teacher.application.resubmit({})).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(services.calls).toEqual([]);
  });
});
