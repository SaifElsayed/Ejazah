// T113: how the kernel and every module read an operational number (FR-034, R-MONEY-12, R-API-4).
//
// Every threshold, window, offset and limit lives in the `settings` table, which the admin module
// owns. The kernel may not import `modules/admin` (R-API-4), so it declares only this contract;
// the admin module implements it over its table, and `main.ts` and `worker.ts` bind that
// implementation and hand it to what reads settings (T143 lets those two import admin's entry).
//
// FAILS CLOSED. A key that is not stored, or whose value the caller's schema refuses, throws
// `SettingError`: never a constant in its place and never "no limit". The error filter answers it
// as the internal error, so it is logged and reported, and the operator fixes the store. The
// message names the key and the problem, never the value (R-SEC-2).
//
// No key is read at startup: the store is filled by the seed (T074) and by the admin panel, and an
// empty store must not stop a process booting (quickstart §1). The startup check is only that a
// reader is bound.
import type { z } from 'zod';

export interface SettingsReader {
  /** The value stored under `key`, as `schema` reads it. Throws `SettingError` when it cannot. */
  read<T>(key: string, schema: z.ZodType<T>): Promise<T>;
}

export type SettingProblem = 'missing' | 'invalid';

export class SettingError extends Error {
  readonly key: string;
  readonly problem: SettingProblem;

  constructor(key: string, problem: SettingProblem) {
    super(`Setting "${key}" is ${problem}; nothing stands in for it (FR-034)`);
    this.name = 'SettingError';
    this.key = key;
    this.problem = problem;
  }
}

export class SettingsReaderUnboundError extends Error {
  constructor() {
    super('No SettingsReader is bound; refusing to start (FR-034)');
    this.name = 'SettingsReaderUnboundError';
  }
}

/** The bound reader, or the refusal that stops the process before it serves anything. */
export function requireSettingsReader(reader: SettingsReader | undefined): SettingsReader {
  if (reader === undefined) throw new SettingsReaderUnboundError();
  return reader;
}
