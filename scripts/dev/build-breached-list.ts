// T040 (FR-128, research R-105): writes the bundled breached-password list the API searches,
// `apps/api/src/platform/crypto/breached-passwords/top-100k.bin`, from a published list.
//
//   pnpm exec tsx scripts/dev/build-breached-list.ts --input <path to the list>
//
// THE SOURCE (owner's decision, 2026-10-19). SecLists, the top 100,000 of the "10 million passwords"
// list Mark Burnett published from public breaches, at a fixed commit. SecLists is MIT-licensed,
// Copyright (c) 2018 Daniel Miessler; the derived file the API ships carries that notice here:
// https://github.com/danielmiessler/SecLists/blob/c205c36a445bff37f8e58a9ec829105cd4975c58/LICENSE
//
//   https://raw.githubusercontent.com/danielmiessler/SecLists/c205c36a445bff37f8e58a9ec829105cd4975c58/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt
//   100,000 lines, 781,879 bytes, SHA-256 1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b
//
// The script does not fetch: the list is downloaded by hand, its hash checked against the one
// above, and handed in, so a run never depends on the network and a changed upstream file is
// refused rather than built. Replacing the list is a new source here, a new run and one commit.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  buildList,
  PREFIX_BYTES,
} from '../../apps/api/src/platform/crypto/breached-passwords/index';

const SOURCE_SHA256 = '1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b';

const OUTPUT = join(
  __dirname,
  '..',
  '..',
  'apps',
  'api',
  'src',
  'platform',
  'crypto',
  'breached-passwords',
  'top-100k.bin',
);

function main(argv: readonly string[]): number {
  const { values } = parseArgs({ args: [...argv], options: { input: { type: 'string' } } });
  if (values.input === undefined) {
    process.stderr.write('build-breached-list: --input <path to the list> is required\n');
    return 2;
  }
  const source = readFileSync(values.input);
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== SOURCE_SHA256) {
    process.stderr.write(
      `build-breached-list: the list's SHA-256 is ${digest}, not the recorded ${SOURCE_SHA256}; nothing was written\n`,
    );
    return 1;
  }
  const list = buildList(source.toString('utf8').split(/\r?\n/));
  writeFileSync(OUTPUT, list);
  process.stdout.write(
    `build-breached-list: wrote ${list.length / PREFIX_BYTES} prefixes to top-100k.bin\n`,
  );
  return 0;
}

// Run as a command (tsx), never when a test imports this file.
if (basename(process.argv[1] ?? '') === 'build-breached-list.ts') {
  process.exitCode = main(process.argv.slice(2));
}
