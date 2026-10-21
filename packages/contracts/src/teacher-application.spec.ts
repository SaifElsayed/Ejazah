// T055 — the `teacher.application` schemas of contracts/app-surface.md (FR-150, FR-VERIFY-11).
// Written beside the schemas, so it passed on its first run (as T046 did, note under T046).
//
// No field of any application schema, at any depth, names a payout, bank, wallet or account: the
// test walks every key of every schema the module exports, so a field added later is read too.
// Then the bounds the form is held to: one to ten subjects, a qualification of one to
// QUALIFICATION_MAX_LENGTH characters after trimming.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as application from './teacher-application.js';
import {
  APPLICATION_SUBJECTS_MAX,
  applicationReapplyInput,
  applicationResubmitInput,
  applicationSubmitInput,
  QUALIFICATION_MAX_LENGTH,
} from './teacher-application.js';

/** A field name that would carry a payout detail (FR-VERIFY-11, FR-PAYG-12). */
const PAYOUT_FIELD = /payout|bank|wallet|account|iban|card/i;

/** Every key of `schema`, at any depth, as a dotted path. */
function keysOf(schema: z.ZodType, at = ''): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape as Record<string, z.ZodType>).flatMap(([key, inner]) => [
      `${at}${key}`,
      ...keysOf(inner, `${at}${key}.`),
    ]);
  }
  if (schema instanceof z.ZodArray) return keysOf(schema.element as z.ZodType, `${at}[].`);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return keysOf(schema.unwrap() as z.ZodType, at);
  }
  if (schema instanceof z.ZodPipe) return keysOf(schema.in as z.ZodType, at);
  return [];
}

const schemas = Object.entries(application as Readonly<Record<string, unknown>>).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);

const ids = {
  subject: '0199d0a0-0000-7000-8000-000000000051',
  other: '0199d0a0-0000-7000-8000-000000000052',
  identity: '0199d0a0-0000-7000-8000-0000000000d1',
  ijazah: '0199d0a0-0000-7000-8000-0000000000d2',
};

const submit = {
  subjectIds: [ids.subject],
  qualificationSummary: 'إجازة في حفظ القرآن برواية حفص، أدرّس منذ ثماني سنوات',
  identityDocument: { type: 'national_id', documentId: ids.identity },
  credentials: [{ subjectId: ids.subject, documentId: ids.ijazah }],
  idempotencyKey: 'apply-0199d0a0-0000-7000',
} as const;

const subjects = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `0199d0a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
  );

describe('the application schemas', () => {
  it('are read, all of them, by the walk below', () => {
    expect(schemas.map(([name]) => name).sort()).toEqual([
      'applicationGetOutput',
      'applicationReapplyInput',
      'applicationResubmitInput',
      'applicationStatus',
      'applicationSubmitInput',
      'idempotencyKey',
    ]);
    expect(keysOf(applicationSubmitInput)).toContain('credentials.[].documentId');
  });

  it('name no payout, bank, wallet or account field, at any depth (FR-VERIFY-11)', () => {
    for (const [name, schema] of schemas) {
      for (const key of keysOf(schema)) {
        expect(`${name}.${key}`).not.toMatch(PAYOUT_FIELD);
      }
    }
  });

  it('drop a payout detail a client sends, so none reaches the service', () => {
    const parsed = applicationSubmitInput.parse({ ...submit, payoutAccount: 'EG00 1234' });
    expect(parsed).not.toHaveProperty('payoutAccount');
  });
});

describe('the subject count (1 to 10)', () => {
  it('takes one and APPLICATION_SUBJECTS_MAX subjects', () => {
    expect(APPLICATION_SUBJECTS_MAX).toBe(10);
    expect(applicationSubmitInput.safeParse(submit).success).toBe(true);
    const most = subjects(APPLICATION_SUBJECTS_MAX);
    expect(applicationReapplyInput.safeParse({ ...submit, subjectIds: most }).success).toBe(true);
  });

  it('refuses none and one more than APPLICATION_SUBJECTS_MAX', () => {
    expect(applicationSubmitInput.safeParse({ ...submit, subjectIds: [] }).success).toBe(false);
    const tooMany = subjects(APPLICATION_SUBJECTS_MAX + 1);
    expect(applicationSubmitInput.safeParse({ ...submit, subjectIds: tooMany }).success).toBe(
      false,
    );
    expect(applicationReapplyInput.safeParse({ ...submit, subjectIds: tooMany }).success).toBe(
      false,
    );
  });
});

describe('the qualification length', () => {
  it('takes QUALIFICATION_MAX_LENGTH characters, trimmed', () => {
    const longest = 'ق'.repeat(QUALIFICATION_MAX_LENGTH);
    const parsed = applicationSubmitInput.parse({
      ...submit,
      qualificationSummary: `  ${longest}  `,
    });
    expect(parsed.qualificationSummary).toBe(longest);
  });

  it('refuses one character more, and an empty or blank sentence', () => {
    for (const qualificationSummary of ['ق'.repeat(QUALIFICATION_MAX_LENGTH + 1), '', '   ']) {
      expect(applicationSubmitInput.safeParse({ ...submit, qualificationSummary }).success).toBe(
        false,
      );
    }
  });
});

describe('the other inputs', () => {
  it('submit carries the idempotency key, reapply does not', () => {
    const { idempotencyKey: _key, ...reapply } = submit;
    expect(applicationSubmitInput.safeParse(reapply).success).toBe(false);
    expect(applicationReapplyInput.safeParse(reapply).success).toBe(true);
    expect(applicationReapplyInput.shape).not.toHaveProperty('idempotencyKey');
  });

  it('resubmit names the identity document, a credential, or both, never neither', () => {
    const credential = { credentialId: ids.other, documentId: ids.ijazah };
    expect(applicationResubmitInput.safeParse({ identityDocumentId: ids.identity }).success).toBe(
      true,
    );
    expect(applicationResubmitInput.safeParse({ credentials: [credential] }).success).toBe(true);
    expect(applicationResubmitInput.safeParse({}).success).toBe(false);
    expect(applicationResubmitInput.safeParse({ credentials: [] }).success).toBe(false);
  });
});
