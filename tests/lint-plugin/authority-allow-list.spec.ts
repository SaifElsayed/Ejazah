// T038 (PR #80 review, 8) — the lint rule reads `packages/contracts/src/authority-allow-list.ts` as
// text; what it reads is the entries inside the exported object and nothing else, so a line in a
// comment, before or after the object, cannot widen the allow-list the exported value holds.
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repositoryRoot } from '../support/lint-contract';

const configRequire = createRequire(
  path.join(repositoryRoot, 'packages', 'config', 'eslint.base.js'),
);
const { parseAllowList } = configRequire(
  path.join(
    repositoryRoot,
    'packages',
    'config',
    'eslint-plugin-ijazah',
    'authority-allow-list.js',
  ),
) as { parseAllowList: (text: string) => Map<string, Set<string>> };

describe('the authority allow-list parser (T038)', () => {
  it('reads the entries of the exported object, each field once', () => {
    const parsed = parseAllowList(`export const authorityAllowList = {
  onboardingCompleteInput: ['gender', 'role'],
  otherInput: ['role'],
} as const satisfies Readonly<Record<string, readonly ('gender' | 'role')[]>>;
`);
    expect([...parsed.keys()]).toEqual(['onboardingCompleteInput', 'otherInput']);
    expect([...(parsed.get('onboardingCompleteInput') ?? [])]).toEqual(['gender', 'role']);
  });

  it('ignores an entry written in a comment outside the object, and one after it', () => {
    const parsed = parseAllowList(`/*
  looseInput: ['gender'],
*/
// commentedInput: ['role'],
export const authorityAllowList = {
  onboardingCompleteInput: ['gender', 'role'],
} as const;
const after = {
  laterInput: ['gender'],
};
`);
    expect([...parsed.keys()]).toEqual(['onboardingCompleteInput']);
  });

  it('refuses a file with no exported object, so a broken list never reads as an empty one', () => {
    expect(() => parseAllowList('export const something = 1;')).toThrow(/authorityAllowList/);
  });
});
