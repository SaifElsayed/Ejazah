// T157: the magic-number gate (FR-034, R-MONEY-12, SC-003). Every operational number, a threshold,
// a window, an offset or a limit, is read from `settings` when it is needed and never exists as a
// constant in code.
//
//   pnpm check:magic-numbers                 reads apps/api/src/modules
//   pnpm check:magic-numbers --root <dir>    reads <dir> instead, relative to the repository root
//
// TOKENS, NOT TEXT. The constitution's cell says "grep"; its intent is that no number in module
// code escapes the check. A grep over text would read the task and rule ids every comment carries
// and the digits of every string, so the gate parses each file with the TypeScript compiler
// (`typescript`, already declared at the root) and judges its numeric literal nodes alone. A
// comment is trivia and never a node; a string, a template's text, a regular expression and JSX
// text are nodes of their own kinds, so a number inside them is never read.
//
// WHAT IS REFUSED. Every numeric or BigInt literal whose value is not 0 or 1, wherever it is written:
// an expression, a property, an array index, a default value, a literal type, an enum member, a
// class property. What a literal is used for cannot be read from syntax (`const n = 5` may be a
// limit, and so may `limit: 5`), so every literal is treated as one; 0 and 1 are the identities
// of counting and indexing, never a setting. A sign is an operator, so `-1` is the literal 1 and
// passes, and `-5` is refused as 5. The value decides, so `1.0`, `0x1` and `0n` pass, and a
// refusal quotes the literal as written (`86_400`, `30n`). There is no allowlist: a unit
// conversion belongs in `@ijazah/time` or `@ijazah/money`, outside the scanned root.
//
// WHAT IS READ. Every `.ts`, `.tsx`, `.mts` and `.cts` file under the root, except specs
// (`*.spec.*`, `*.test.*`) and any `__fixtures__` folder. `tests/violations/fixtures/**`, whose
// fixtures break this rule on purpose (note under T081, PR #11), lies outside the default root.
//
// Exit 0 silently when no literal is refused, 1 listing every refusal, 2 on a bad argument or a
// root (or a file under it) that cannot be read.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import ts from 'typescript';

const repositoryRoot = join(__dirname, '..');

/** The tree the gate reads by default, relative to the repository root. */
export const DEFAULT_ROOT = 'apps/api/src/modules';

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
};
const SPEC = /\.(?:spec|test)\.[cm]?tsx?$/;
const SKIPPED_FOLDERS = new Set(['__fixtures__']);

/** One refused literal: where it is, 1-based, and its text as written. */
export interface Refusal {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly literal: string;
}

function scriptKindOf(fileName: string): ts.ScriptKind | undefined {
  const extension = /\.[cm]?tsx?$/.exec(fileName)?.[0];
  return extension === undefined ? undefined : SCRIPT_KINDS[extension];
}

/** Whether the gate reads this file: a TypeScript source that is not a spec. */
export function isScanned(fileName: string): boolean {
  return scriptKindOf(fileName) !== undefined && !SPEC.test(fileName);
}

/** Whether a literal's value is 0 or 1; the compiler normalises its text (`0x1` reads "1"). */
function isIdentity(node: ts.NumericLiteral | ts.BigIntLiteral): boolean {
  if (ts.isBigIntLiteral(node)) return node.text === '0n' || node.text === '1n';
  const value = Number(node.text);
  return value === 0 || value === 1;
}

/** Every numeric or BigInt literal other than 0 and 1 in one file's text, in source order. */
export function findMagicNumbers(text: string, fileName: string): Refusal[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName) ?? ts.ScriptKind.TS,
  );
  const refusals: Refusal[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) && !isIdentity(node)) {
      const start = node.getStart(source);
      const { line, character } = source.getLineAndCharacterOfPosition(start);
      refusals.push({
        file: fileName,
        line: line + 1,
        column: character + 1,
        literal: text.slice(start, node.getEnd()),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refusals;
}

/** Every file the gate reads under `directory`, in code-point order. Throws when one cannot be read. */
function scannedFiles(directory: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) files.push(...scannedFiles(path));
    } else if (entry.isFile() && isScanned(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** The refusal as the pipeline log shows it. */
export function formatRefusal(refusal: Refusal): string {
  return `R-MONEY-12: ${refusal.file}:${refusal.line}:${refusal.column} the numeric literal ${refusal.literal} is a constant in code; a threshold, window, offset or limit must be read from settings (FR-034), and only 0 and 1 may be written as literals.`;
}

interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** The command: 0 when no literal is refused, 1 on a refusal, 2 on a bad argument or unreadable root. */
export function main(argv: readonly string[], cwd: string, streams: Streams): number {
  let rootArgument: string | undefined;
  try {
    ({
      values: { root: rootArgument },
    } = parseArgs({
      args: [...argv],
      options: { root: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error: unknown) {
    streams.err(`magic-number gate: ${error instanceof Error ? error.message : 'bad arguments'}\n`);
    return 2;
  }
  if (rootArgument === '') {
    streams.err('magic-number gate: --root needs a directory\n');
    return 2;
  }
  const root = resolve(cwd, rootArgument ?? DEFAULT_ROOT);
  const shown = (path: string): string => relative(cwd, path).split(sep).join('/');

  const refusals: Refusal[] = [];
  try {
    if (!statSync(root).isDirectory()) throw new Error('it is not a directory');
    for (const file of scannedFiles(root)) {
      refusals.push(...findMagicNumbers(readFileSync(file, 'utf8'), shown(file)));
    }
  } catch (error: unknown) {
    streams.err(
      `magic-number gate: cannot read ${shown(root) || '.'}: ${error instanceof Error ? error.message : String(error)}; no file was judged\n`,
    );
    return 2;
  }
  for (const refusal of refusals) streams.err(`${formatRefusal(refusal)}\n`);
  return refusals.length === 0 ? 0 : 1;
}

// Run as a command (`pnpm check:magic-numbers`, tsx), never when a test imports this file. tsx
// compiles it as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'magic-number-gate.ts') {
  process.exitCode = main(process.argv.slice(2), repositoryRoot, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
