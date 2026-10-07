// T015: startup loader for the schema in env.schema.ts. Validates every value before the process accepts
// traffic; on failure it exits naming the offending keys (FR-039). Key names only, never values (R-SEC-2).
// Plain module on purpose: the kernel depends on nothing in modules and needs no framework to refuse to start.
import { z } from 'zod';
import { type Env, envKeys, envSchema } from './env.schema.js';

// The owner connection string is used only by db:migrate and the pipeline (research R-5).
export type Config = Omit<Env, 'DATABASE_URL_OWNER'>;

export class ConfigError extends Error {
  readonly offendingKeys: readonly string[];

  constructor(offendingKeys: readonly string[], detail: string) {
    super(`Invalid configuration, refusing to start (FR-039): ${detail}`);
    this.name = 'ConfigError';
    this.offendingKeys = offendingKeys;
  }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

// A copied .env.example leaves optional values as `KEY=`; an empty string is "unset", not a value.
function declaredValues(source: EnvSource): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    const value = source[key];
    values[key] = value === '' ? undefined : value;
  }
  return values;
}

function describe(error: z.ZodError): { keys: string[]; detail: string } {
  const byKey = new Map<string, string[]>();
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '(root)');
    byKey.set(key, [...(byKey.get(key) ?? []), issue.message]);
  }
  const keys = [...byKey.keys()];
  const detail = keys.map((key) => `${key} (${byKey.get(key)?.join('; ')})`).join(', ');
  return { keys, detail };
}

export function loadConfig(source: EnvSource = process.env): Config {
  const result = envSchema.safeParse(declaredValues(source));
  if (!result.success) {
    const { keys, detail } = describe(result.error);
    throw new ConfigError(keys, detail);
  }
  const { DATABASE_URL_OWNER: _owner, ...config } = result.data;
  return config;
}

// The first call in main.ts and worker.ts (T149, note under T015), so nothing listens until it returns.
export function loadConfigOrExit(source: EnvSource = process.env): Config {
  try {
    return loadConfig(source);
  } catch (error: unknown) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return process.exit(1);
  }
}
