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

const covering: ModuleSpec[] = [
  {
    path: 'apps/api/src/modules/identity/account.spec.ts',
    text: "it('refuses an anonymous caller', () => expect(call('account.me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }));",
  },
  {
    path: 'apps/api/src/modules/verification/application.spec.ts',
    text: "await expect(student.teacher.application.submit(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });",
  },
  {
    path: 'apps/api/src/modules/booking/booking.spec.ts',
    text: "const path = `booking.create`;\nexpect(error.code).toBe('ACCOUNT_RESTRICTED');",
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
