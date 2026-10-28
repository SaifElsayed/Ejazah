// T099: a mutation reaches its procedure over HTTP only when its client sends a body. tRPC 11.19's
// client (`httpLink`) sends a mutation whose input is `undefined` with no body at all, and its
// server's JSON handler reads every mutation's body as JSON, so an empty one fails before the
// procedure's schema runs (400 `VALIDATION_FAILED` since T108; 500 before it). A mutation that
// takes nothing therefore takes the contracts' empty object
// (`emptyInput`, `adminEmptyInput`), and this check finds any mutation whose input still accepts
// `undefined`, on either surface, so none can be declared again.
import type { AnyProcedure, AnyRouter } from '@trpc/server';

/** What the check reads of an input parser: the Standard Schema interface every Zod schema has. */
interface StandardParser {
  readonly '~standard': {
    readonly validate: (value: unknown) =>
      | { readonly issues?: unknown }
      | PromiseLike<{
          readonly issues?: unknown;
        }>;
  };
}

function isStandardParser(parser: unknown): parser is StandardParser {
  return typeof parser === 'object' && parser !== null && '~standard' in parser;
}

/** Whether `parser` admits `undefined`; a parser that cannot say is read as admitting it. */
async function admitsUndefined(parser: unknown): Promise<boolean> {
  if (!isStandardParser(parser)) return true;
  const result = await parser['~standard'].validate(undefined);
  return result.issues === undefined;
}

/** Why a mutation's input lets its client send no body, or undefined when it does not. */
async function bodilessReason(procedure: AnyProcedure): Promise<string | undefined> {
  const inputs: readonly unknown[] = procedure._def.inputs;
  if (inputs.length === 0) return 'declares no input';
  for (const parser of inputs) {
    if (!(await admitsUndefined(parser))) return undefined;
  }
  return 'its input accepts undefined';
}

/**
 * Every mutation of `router` that tRPC 11.19's client would send with no body, as
 * `path: reason`, in path order. Empty when every mutation takes an input that refuses `undefined`.
 */
export async function mutationsSentWithoutBody(router: AnyRouter): Promise<string[]> {
  const procedures = Object.entries(router._def.procedures as Record<string, AnyProcedure>);
  const found = await Promise.all(
    procedures
      .filter(([, procedure]) => procedure._def.type === 'mutation')
      .map(async ([path, procedure]) => {
        const reason = await bodilessReason(procedure);
        return reason === undefined
          ? undefined
          : `${path}: ${reason}, so the client sends it with no body and the server cannot read it (T099)`;
      }),
  );
  return found.filter((entry): entry is string => entry !== undefined).sort();
}
