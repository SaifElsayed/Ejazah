// T140: the suppression gate (FR-008, R-PROC-7).
//
//   pnpm check:suppressions
//
// `proc/require-suppression-reason` refuses an unjustified suppression in `pnpm lint`, but a file
// whose inline configuration switches that very rule off is never judged there: ESLint applies the
// comment before any rule runs, and a second rule could be switched off by the same comment. The
// gate is the same rule run a second time where no comment can reach it.
//
// HOW. One ESLint run through the Node API over the repository's own `eslint.config.js`, so the
// file set, the parser and the ignores are those of `pnpm lint` and cannot drift from them, with:
//   allowInlineConfig: false  every directive is ignored as a directive and still read as a
//                             comment, so the rule judges all of them. Chosen over
//                             `linterOptions.noInlineConfig`, which adds one warning per directive;
//   ruleFilter                the suppression rule and no other, so the run judges suppressions only.
// It fails on errors only. With inline configuration off no directive is ever unused, so the
// type-aware set's `reportUnusedDisableDirectives: 'error'` cannot fire here.
//
// The gate reuses the rule's own reading of a directive, which T041's spec holds to ESLint's, so
// the two cannot disagree; a new directive kind needs the rule updated and the gate follows it.
//
// Exit 0 when every suppression is justified, 1 when the gate reports an error (each named by
// R-PROC-7 in the rule's message), 2 when the run itself fails.
import { basename, join, relative, sep } from 'node:path';

import { ESLint } from 'eslint';

const repositoryRoot = join(__dirname, '..');

/** The rule the gate runs, as the fast set registers it. */
export const SUPPRESSION_RULE = 'ijazah/proc/require-suppression-reason';

/** The gate: `pnpm lint`'s configuration, inline configuration off, the suppression rule alone. */
export function createSuppressionGate(cwd: string = repositoryRoot): ESLint {
  return new ESLint({
    cwd,
    overrideConfigFile: join(cwd, 'eslint.config.js'),
    allowInlineConfig: false,
    ruleFilter: ({ ruleId }) => ruleId === SUPPRESSION_RULE,
  });
}

interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Runs the gate over `patterns` (the repository, as `pnpm lint` does, by default). */
export async function main(patterns: readonly string[], streams: Streams): Promise<number> {
  const gate = createSuppressionGate();
  const results = await gate.lintFiles(patterns.length === 0 ? ['.'] : [...patterns]);
  const errors = results.flatMap((result) =>
    result.messages
      .filter((message) => message.severity === 2)
      .map((message) => {
        const path = relative(repositoryRoot, result.filePath).split(sep).join('/');
        return `${path}:${message.line}:${message.column}  ${message.message}\n`;
      }),
  );
  const errorCount = errors.length;
  if (errorCount === 0) {
    streams.out(
      `suppression gate: ${results.length} files read with inline configuration off; every suppression is justified (R-PROC-7)\n`,
    );
    return 0;
  }
  for (const line of errors) streams.err(line);
  streams.err(
    `suppression gate: ${errorCount} unjustified suppression${errorCount === 1 ? '' : 's'}, read with inline configuration off, so no comment could switch the check off (R-PROC-7)\n`,
  );
  return 1;
}

// Run as a command (`pnpm check:suppressions`, tsx), never when a test imports this file. tsx
// compiles it as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'suppression-gate.ts') {
  main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `suppression gate: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 2;
    },
  );
}
