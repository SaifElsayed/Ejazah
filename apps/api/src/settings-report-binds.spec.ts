// 002:T180 (R2's note): `main.ts` and `worker.ts` each report, right after binding the settings
// reader, the registry's keys missing from the database (`reportMissingSettings` of the admin
// module's entry), awaited, under a comment naming `002:T180`; the report never throws, so neither
// process refuses to start. The entrypoints start a process when imported, so their source is read
// and parsed with TypeScript, as `api-bind-address-binds.spec.ts` and `programme-cards-binds.spec.ts`
// (006:T013's precedent) do.
//
// Observed red: `main.ts` and `worker.ts` before the calls.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function sourceOf(file: string): ts.SourceFile {
  const text = readFileSync(path.join(here, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** The top-level statement right after the one that binds `settings`, with its leading comments. */
function afterTheReader(file: string): { text: string; comments: string } {
  const source = sourceOf(file);
  const index = source.statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => declaration.name.getText(source) === 'settings',
      ),
  );
  expect(index, `${file} binds settings`).toBeGreaterThanOrEqual(0);
  const next = source.statements[index + 1];
  if (next === undefined) return { text: '', comments: '' };
  const full = source.getFullText();
  const comments = (ts.getLeadingCommentRanges(full, next.getFullStart()) ?? [])
    .map(({ pos, end }) => full.slice(pos, end))
    .join('\n');
  return { text: next.getText(source), comments };
}

/** Every call of `callee(…)` in the file, by its callee's text. */
function callsOf(file: string, callee: string): ts.CallExpression[] {
  const source = sourceOf(file);
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === callee) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the processes report missing settings at start-up (002:T180)', () => {
  it('main.ts awaits the report right after the settings reader, under 002:T180', () => {
    const { text, comments } = afterTheReader('main.ts');
    expect(text).toBe('await reportMissingSettings(database, log);');
    expect(comments).toContain('002:T180');
    expect(callsOf('main.ts', 'reportMissingSettings')).toHaveLength(1);
  });

  it('worker.ts awaits the report right after its settings reader, under 002:T180', () => {
    const { text, comments } = afterTheReader('worker.ts');
    expect(text).toBe('await admin.reportMissingSettings(database, log);');
    expect(comments).toContain('002:T180');
    expect(callsOf('worker.ts', 'admin.reportMissingSettings')).toHaveLength(1);
  });
});
