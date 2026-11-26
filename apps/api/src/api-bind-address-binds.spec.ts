// 002:T181 (R2's note, Q-7 (a)): `main.ts` listens on API_BIND_ADDRESS when it is set, and on every
// interface when it is not (the phone on the same network needs that in development). The
// entrypoint starts a process when imported, so its source is read and parsed with TypeScript, as
// `programme-cards-binds.spec.ts` (006:T013's precedent) and `advance-programmes-binds.spec.ts` do.
//
// Observed red: `main.ts` before the bind (`application.listen(config.PORT)`).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function sourceOf(file: string): ts.SourceFile {
  const text = readFileSync(path.join(here, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** Every `application.listen(…)` call in the file: its arguments' text, and the node itself. */
function listensOf(source: ts.SourceFile): { args: string[]; node: ts.CallExpression }[] {
  const found: { args: string[]; node: ts.CallExpression }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'listen' &&
      node.expression.expression.getText(source) === 'application'
    ) {
      found.push({ args: node.arguments.map((argument) => argument.getText(source)), node });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the API listens on API_BIND_ADDRESS when set (002:T181, Q-7 (a))', () => {
  const source = sourceOf('main.ts');
  const listens = listensOf(source);

  it('passes the address to listen as the host', () => {
    expect(listens.map(({ args }) => args)).toContainEqual([
      'config.PORT',
      'config.API_BIND_ADDRESS',
    ]);
  });

  it('listens on every interface only when the address is unset', () => {
    for (const { args, node } of listens) {
      if (args.length !== 1) continue;
      expect(args).toEqual(['config.PORT']);
      const branch = node.parent;
      expect(ts.isConditionalExpression(branch)).toBe(true);
      const conditional = branch as ts.ConditionalExpression;
      expect(conditional.whenTrue).toBe(node);
      expect(conditional.condition.getText(source)).toBe('config.API_BIND_ADDRESS === undefined');
    }
  });

  it('listens once', () => {
    // The two calls are the two branches of one choice, so the process opens one socket.
    expect(listens.length).toBeLessThanOrEqual(2);
    const parents = new Set(listens.map(({ node }) => node.parent));
    expect(parents.size).toBe(1);
  });
});
