// T027 (FR-138, R-HONEST-4, R-API-9): the output leak test over `contract-snapshot.json`. Every
// output field of the user surface is read from the committed snapshot, which holds each
// procedure's output schema field by field (T084), so the first procedure whose output names
// another person's date of birth, a storage key, a hash, a provider subject or a recipient
// reference fails the suite before a reviewer has to see it. A second case holds the keyed
// procedures (`idempotent-procedures.ts`) to no session token in their output, since the kernel
// replays a stored outcome as stored (kernel.md "Idempotency"). Stage 2 of the pipeline runs this
// file with the rest of the suite.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { idempotentProcedures } from '../../packages/contracts/src/idempotent-procedures';
import {
  type AllowedOutputField,
  allowedOutputFields,
  type ForbiddenName,
  forbiddenOutputNames,
  tokenOutputNames,
} from './output-leak.names';

interface Snapshot {
  readonly procedures: Readonly<
    Record<
      string,
      Readonly<Record<string, { readonly output?: Readonly<Record<string, unknown>> }>>
    >
  >;
}

interface Leak {
  readonly procedure: string;
  readonly field: string;
  readonly reason: string;
}

const snapshotPath = path.resolve(
  __dirname,
  '..',
  '..',
  'packages',
  'contracts',
  'contract-snapshot.json',
);

/** `$.user.date_of_birth` → `dateofbirth`: the last segment, no `[]`, no case, no underscore. */
function normalised(field: string): string {
  const last = field.split('.').pop() ?? field;
  return last.replace(/\[\]$/, '').replace(/_/g, '').toLowerCase();
}

/** Every output field of the user surface whose name is forbidden and not allowed there. */
export function findLeaks(
  snapshot: Snapshot,
  forbidden: readonly ForbiddenName[] = forbiddenOutputNames,
  allowed: readonly AllowedOutputField[] = allowedOutputFields,
): Leak[] {
  const reasons = new Map(forbidden.map((entry) => [entry.name.toLowerCase(), entry.reason]));
  const leaks: Leak[] = [];
  for (const [procedure, shape] of Object.entries(snapshot.procedures['app'] ?? {})) {
    for (const field of Object.keys(shape.output ?? {})) {
      const reason = reasons.get(normalised(field));
      if (reason === undefined) continue;
      if (allowed.some((entry) => entry.procedure === procedure && entry.field === field)) continue;
      leaks.push({ procedure, field, reason });
    }
  }
  return leaks;
}

/** Every token a keyed procedure's output names. */
export function findReplayedTokens(snapshot: Snapshot, keyed: readonly string[]): Leak[] {
  const tokens = new Set(tokenOutputNames.map((name) => name.toLowerCase()));
  const leaks: Leak[] = [];
  for (const procedure of keyed) {
    const shape = snapshot.procedures['app']?.[procedure];
    for (const field of Object.keys(shape?.output ?? {})) {
      if (tokens.has(normalised(field))) {
        leaks.push({
          procedure,
          field,
          reason: 'a session token in a replayed outcome (kernel.md Idempotency)',
        });
      }
    }
  }
  return leaks;
}

/** The failure a reviewer reads: each leak by procedure and field, then the rule. */
export function describeLeaks(leaks: readonly Leak[]): string {
  return [
    ...leaks.map((leak) => `${leak.procedure} ${leak.field}: ${leak.reason}`),
    'R-HONEST-4: no user-facing output names another person’s data (FR-138)',
  ].join('\n');
}

const committed = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;

describe('the output leak test (T027)', () => {
  it('finds no forbidden field in any output of the user surface', () => {
    const leaks = findLeaks(committed);
    expect(leaks, describeLeaks(leaks)).toEqual([]);
  });

  it('finds no session token in the output of a keyed procedure', () => {
    const leaks = findReplayedTokens(committed, idempotentProcedures);
    expect(leaks, describeLeaks(leaks)).toEqual([]);
  });

  it('fails a leaking output, naming the procedure, the field and R-HONEST-4', () => {
    const fixture: Snapshot = {
      procedures: {
        admin: { 'admin.user.get': { output: { '$.dateOfBirth': {} } } },
        app: {
          'teacher.profile.get': {
            output: {
              $: {},
              '$.displayName': {},
              '$.date_of_birth': {},
              '$.documents[].storageKey': {},
            },
          },
        },
      },
    };
    const leaks = findLeaks(fixture);
    expect(leaks.map((leak) => leak.field)).toEqual([
      '$.date_of_birth',
      '$.documents[].storageKey',
    ]);
    const message = describeLeaks(leaks);
    expect(message).toContain('teacher.profile.get $.date_of_birth');
    expect(message).toContain('R-HONEST-4');
  });

  it("allows the person's own date of birth on account.me, and nowhere else", () => {
    const fixture: Snapshot = {
      procedures: {
        app: {
          'account.me': { output: { '$.dateOfBirth': {} } },
          'teacher.list': { output: { '$[].dateOfBirth': {} } },
        },
      },
    };
    expect(findLeaks(fixture).map((leak) => `${leak.procedure} ${leak.field}`)).toEqual([
      'teacher.list $[].dateOfBirth',
    ]);
  });

  it('fails a keyed procedure that answers a token', () => {
    const fixture: Snapshot = {
      procedures: { app: { 'account.delete': { output: { '$.accessToken': {} } } } },
    };
    expect(findReplayedTokens(fixture, idempotentProcedures)).toHaveLength(1);
  });

  it('reads nothing the list does not name: a forbidden word inside a longer name passes', () => {
    const fixture: Snapshot = {
      procedures: { app: { 'catalog.subjects.list': { output: { '$[].photoKeyCount': {} } } } },
    };
    expect(findLeaks(fixture)).toEqual([]);
  });
});
