// T028 (R-MOBILE-13, FR-210, research R-115): the authorization-test gate. Hiding an action in the
// UI is not authorization: every user-surface procedure a screen can reach that is not public has a
// module spec that names its path and asserts the refusal of the wrong caller. The gate reads the
// caller kinds from the committed contract snapshot (T028 records them) and the specs from
// `apps/api/src/modules/**`.
import { describe, expect, it } from 'vitest';

import {
  describeUntested,
  findUntested,
  main,
  type ModuleSpec,
  type SnapshotProcedures,
} from '../../scripts/authz-test-gate';

const snapshot: SnapshotProcedures = {
  admin: { 'settings.update': { kind: 'mutation' } },
  app: {
    'catalog.subjects.list': { caller: 'public', kind: 'query' },
    'account.me': { caller: 'user', kind: 'query' },
    'teacher.application.submit': { caller: 'teacher', kind: 'mutation' },
    'booking.create': { caller: 'student', kind: 'mutation' },
  },
};

// Each kind's own refusals (kernel.md "Caller kinds"): a user procedure refuses an anonymous
// caller (UNAUTHENTICATED); a student or teacher procedure refuses an anonymous caller and a caller
// of the other role (UNAUTHENTICATED and FORBIDDEN). Each is asserted in a test that names the path.
const covering: ModuleSpec[] = [
  {
    path: 'apps/api/src/modules/identity/account.spec.ts',
    text: "it('refuses an anonymous caller', async () => {\n  await expect(call('account.me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });\n});",
  },
  {
    path: 'apps/api/src/modules/verification/application.spec.ts',
    text: [
      "it('refuses an anonymous caller', async () => {",
      "  await expect(anonymous.teacher.application.submit(input)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });",
      '});',
      "it('refuses a student', async () => {",
      "  await expect(student.teacher.application.submit(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });",
      '});',
    ].join('\n'),
  },
  {
    path: 'apps/api/src/modules/booking/booking.spec.ts',
    text: "test('refuses the wrong callers of booking.create', async () => {\n  const path = `booking.create`;\n  expect(await codes(path)).toEqual(['UNAUTHENTICATED', 'FORBIDDEN']);\n});",
  },
];

describe('the authorization-test gate (T028)', () => {
  it('passes when every procedure that is not public has a spec naming it and a refusal', () => {
    expect(findUntested(snapshot, covering)).toEqual([]);
  });

  it('never asks a public procedure or the administrator surface for one', () => {
    expect(findUntested(snapshot, covering.slice(0, 0))).toEqual([
      'account.me',
      'booking.create',
      'teacher.application.submit',
    ]);
  });

  it('fails a procedure whose spec names it without asserting a refusal', () => {
    const named = [
      { path: 'apps/api/src/modules/identity/account.spec.ts', text: "call('account.me')" },
    ];
    expect(findUntested(snapshot, [...named, ...covering.slice(1)])).toEqual(['account.me']);
  });

  it('fails a procedure whose refusal is asserted in a spec that does not name it', () => {
    const elsewhere = [
      {
        path: 'apps/api/src/modules/identity/other.spec.ts',
        text: "expect(code).toBe('UNAUTHENTICATED')",
      },
    ];
    expect(findUntested(snapshot, [...elsewhere, ...covering.slice(1)])).toEqual(['account.me']);
  });

  it('reads a procedure whose snapshot entry names no caller kind as guarded', () => {
    const unknown: SnapshotProcedures = {
      admin: {},
      app: { 'account.delete': { kind: 'mutation' } },
    };
    expect(findUntested(unknown, [])).toEqual(['account.delete']);
  });

  it('fails a procedure named only in a comment (review of B7, 3)', () => {
    const commented = [
      {
        path: 'apps/api/src/modules/identity/account.spec.ts',
        text: "// covers 'account.me' too\nit('refuses', () => { expect(call('account.other')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); });",
      },
    ];
    expect(findUntested(snapshot, [...commented, ...covering.slice(1)])).toEqual(['account.me']);
  });

  it('fails a procedure named in one test and refused in another (review of B7, 3)', () => {
    const apart = [
      {
        path: 'apps/api/src/modules/identity/account.spec.ts',
        text: "it('answers', () => call('account.me'));\nit('refuses', () => expect(call('account.other')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }));",
      },
    ];
    expect(findUntested(snapshot, [...apart, ...covering.slice(1)])).toEqual(['account.me']);
  });

  it('asks each kind for its own refusals: a teacher procedure refused only as anonymous fails (review of B7, 3)', () => {
    const onlyAnonymous = [
      covering[0] as ModuleSpec,
      {
        path: 'apps/api/src/modules/verification/application.spec.ts',
        text: "it('refuses an anonymous caller', async () => {\n  await expect(anonymous.teacher.application.submit(input)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });\n});",
      },
      covering[2] as ModuleSpec,
    ];
    expect(findUntested(snapshot, onlyAnonymous)).toEqual(['teacher.application.submit']);
  });

  it('reads a URL in a string as a string, not as a comment (review of B7, round 2, 2)', () => {
    const withUrl = [
      {
        path: 'apps/api/src/modules/identity/account.spec.ts',
        text: "it('refuses an anonymous caller', async () => {\n  const origin = 'https://api.test';\n  await expect(call(origin, 'account.me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });\n});",
      },
    ];
    expect(findUntested(snapshot, [...withUrl, ...covering.slice(1)])).toEqual([]);
  });

  it('never lets a glob in a string merge two tests (review of B7, round 2, 2)', () => {
    const merged = [
      {
        path: 'apps/api/src/modules/identity/account.spec.ts',
        text: "it('answers', () => { const files = '**/*.spec.ts'; return call('account.me'); });\nit('refuses another', () => { const end = '*/'; expect(call('account.other')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); });",
      },
    ];
    expect(findUntested(snapshot, [...merged, ...covering.slice(1)])).toEqual(['account.me']);
  });

  it('never counts a skipped or a to-do test (review of B7, round 2, 2)', () => {
    const skipped = [
      {
        path: 'apps/api/src/modules/identity/account.spec.ts',
        text: "it('answers', () => call('account.me'));\nit.skip('refuses', () => expect(call('account.me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }));",
      },
    ];
    expect(findUntested(snapshot, [...skipped, ...covering.slice(1)])).toEqual(['account.me']);
  });

  it('reads an it.each table as one test', () => {
    const table = [
      {
        path: 'apps/api/src/modules/identity/account.spec.ts',
        text: "it.each(['account.me'])('refuses an anonymous call of %s', async (path) => {\n  await expect(call(path)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });\n});",
      },
    ];
    expect(findUntested(snapshot, [...table, ...covering.slice(1)])).toEqual([]);
  });

  it('names R-MOBILE-13 and each path', () => {
    const message = describeUntested(['account.me']);
    expect(message).toContain('account.me');
    expect(message).toContain('R-MOBILE-13');
  });

  it('passes this repository today, exit 0', () => {
    const output: string[] = [];
    const code = main([], { out: (text) => output.push(text), err: (text) => output.push(text) });
    expect(code, output.join('')).toBe(0);
  });
});
