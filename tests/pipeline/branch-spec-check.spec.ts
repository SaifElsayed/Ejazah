// T091 — the branch-to-spec-directory check (FR-061, R-PROC-1, ADR 0005 D9).
//
// No spec folder, no branch. A task branch is named `Ejazah_app/<phase>/<task ids>`: `<phase>` is the
// name of an existing `specs/NNN-*` folder, and `<task ids>` is one task id or several joined by `-`
// (a range such as `T001-T005` and a batch list have the same shape), with no descriptive suffix. It
// targets `develop`. `develop` and `main` are exempt as head branches: the integration and release
// branches (owner's decision 7, 2026-10-10). A refusal names R-PROC-1 and the expected form.
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { branchFromEnvironment, checkBranch, specPhases } from '../../scripts/branch-spec-check';

const root = join(__dirname, '..', '..');
const phases = ['001-foundations', '002-identity'];

const problemsOf = (head: string, base: string | undefined = 'develop'): string[] =>
  checkBranch({ head, base, phases });

describe('a task branch named for its spec folder and task ids passes', () => {
  it.each([
    ['this batch’s branch', 'Ejazah_app/001-foundations/T079-T084-T085-T144-T086-T091'],
    ['a single task id', 'Ejazah_app/001-foundations/T001'],
    ['a range', 'Ejazah_app/001-foundations/T001-T005'],
    ['another existing phase', 'Ejazah_app/002-identity/T012'],
  ])('%s', (_, head) => {
    expect(problemsOf(head)).toEqual([]);
  });
});

describe('any other name is refused, naming R-PROC-1 and the expected form', () => {
  it.each([
    ['an unknown phase folder', 'Ejazah_app/999-nothing/T001'],
    ['a slug after the task id', 'Ejazah_app/001-foundations/T001-workspace-root'],
    ['a slugged docs name', 'Ejazah_app/001-foundations/NFR-SEC-11-browser-headers'],
    ['a slugged docs name in place of a phase', 'Ejazah_app/docs/NFR-SEC-11-browser-headers'],
    ['a plan name with no phase', 'Ejazah_app/PLAN-30-day-schedule'],
    ['a fourth segment', 'Ejazah_app/001-foundations/T001/fix'],
    ['a lower-case task id', 'Ejazah_app/001-foundations/t001'],
    ['a task id with no digits', 'Ejazah_app/001-foundations/T'],
    ['another prefix', 'feature/001-foundations/T001'],
    ['the phase alone', 'Ejazah_app/001-foundations'],
    ['an empty name', ''],
  ])('%s', (_, head) => {
    const problems = problemsOf(head);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('R-PROC-1');
    expect(problems[0]).toContain('Ejazah_app/<phase>/<task ids>');
  });

  it('names the phase that has no spec folder, and the folders that exist', () => {
    const [problem] = problemsOf('Ejazah_app/999-nothing/T001');
    expect(problem).toContain('999-nothing');
    expect(problem).toContain('001-foundations');
  });
});

describe('a pull request', () => {
  it('passes the release pull request from develop to main', () => {
    expect(problemsOf('develop', 'main')).toEqual([]);
  });

  it('passes main as a head branch, which is exempt', () => {
    expect(problemsOf('main', 'develop')).toEqual([]);
  });

  it('refuses a task branch that targets main, naming R-PROC-1 and develop', () => {
    const problems = problemsOf('Ejazah_app/001-foundations/T001', 'main');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('R-PROC-1');
    expect(problems[0]).toContain('develop');
  });

  it('reports a badly named branch and a wrong target together', () => {
    expect(problemsOf('Ejazah_app/PLAN-30-day-schedule', 'main')).toHaveLength(2);
  });
});

describe('where the branch names come from', () => {
  it('reads a pull request’s head and base', () => {
    expect(
      branchFromEnvironment({
        GITHUB_HEAD_REF: 'Ejazah_app/001-foundations/T091',
        GITHUB_BASE_REF: 'develop',
        GITHUB_REF_NAME: '57/merge',
      }),
    ).toEqual({ head: 'Ejazah_app/001-foundations/T091', base: 'develop' });
  });

  it('reads a push run’s branch, with no base', () => {
    expect(
      branchFromEnvironment({
        GITHUB_HEAD_REF: '',
        GITHUB_BASE_REF: '',
        GITHUB_REF_NAME: 'develop',
      }),
    ).toEqual({ head: 'develop', base: undefined });
  });

  it('passes a push run on develop or main', () => {
    for (const branch of ['develop', 'main']) {
      const { head, base } = branchFromEnvironment({ GITHUB_REF_NAME: branch });
      expect(checkBranch({ head: head ?? '', base, phases })).toEqual([]);
    }
  });

  it('lists the spec folders this repository holds', () => {
    expect(specPhases(root)).toContain('001-foundations');
    for (const phase of specPhases(root)) expect(phase).toMatch(/^\d{3}-/);
  });
});
