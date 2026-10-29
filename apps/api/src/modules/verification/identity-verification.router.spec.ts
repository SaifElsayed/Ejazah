// T068 — the user surface's `account.identityVerification` namespace as it is served (app-surface.md;
// FR-166). Both procedures are the `user` kind admitting a restricted account: an anonymous caller is
// refused, and a person of either role and any standing reaches the service with their own id, never
// one from the input. What the request does is `verification-request.service.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import { toErrorShape } from '../../surfaces/procedures.js';
import {
  CALLER,
  metaOf,
  recordingServices,
  type Standing,
  surfaceOf,
} from './__fixtures__/surface.js';

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d1';

describe('account.identityVerification.get and account.identityVerification.submit', () => {
  it('account.identityVerification.get refuses an anonymous caller (UNAUTHENTICATED)', async () => {
    const { verification } = recordingServices();
    expect(
      await codeOf(surfaceOf(verification).anonymous().account.identityVerification.get()),
    ).toBe('UNAUTHENTICATED');
  });

  it('account.identityVerification.submit refuses an anonymous caller (UNAUTHENTICATED)', async () => {
    const { verification, calls } = recordingServices();
    expect(
      await codeOf(
        surfaceOf(verification)
          .anonymous()
          .account.identityVerification.submit({ documentType: 'passport', documentId: DOCUMENT }),
      ),
    ).toBe('UNAUTHENTICATED');
    expect(calls).toEqual([]);
  });

  it.each([
    'student',
    'applicant',
    'approved',
    'suspended applicant',
    'banned teacher',
  ] as Standing[])('admits a %s, with their own id', async (standing) => {
    const { verification, calls } = recordingServices();
    const caller = surfaceOf(verification).as(standing);
    expect(await caller.account.identityVerification.get()).toEqual({ open: false });
    await caller.account.identityVerification.submit({
      documentType: 'passport',
      documentId: DOCUMENT,
    });
    expect(calls).toEqual([
      ['identityVerification.get', CALLER],
      ['identityVerification.submit', CALLER, { documentType: 'passport', documentId: DOCUMENT }],
    ]);
  });

  // T115 (b): `lastOutcome` is declared in the output, so the parser keeps it.
  it('answers the last outcome the service read', async () => {
    const { verification } = recordingServices();
    const lastOutcome = {
      status: 'replaced',
      resolvedAt: '2026-10-22T10:00:00.000Z',
      reason: 'الوجه الخلفي غير واضح',
    } as const;
    const answer = { open: true, reason: lastOutcome.reason, lastOutcome };
    verification.identityVerification.get = async () => answer;
    expect(await surfaceOf(verification).as('student').account.identityVerification.get()).toEqual(
      answer,
    );
  });

  it('declares the user kind on both', () => {
    for (const path of [
      'account.identityVerification.get',
      'account.identityVerification.submit',
    ]) {
      expect(metaOf(path)).toMatchObject({ surface: 'app', caller: 'user' });
    }
  });
});
