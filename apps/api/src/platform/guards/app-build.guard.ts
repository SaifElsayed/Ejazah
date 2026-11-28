// R3 (002:T184; SRS DEC-99, DEC-109, §3.14 «Minimum app build admitted»; ARCHITECTURE §7.3 as
// amended; constitution R-API-9) — the build floor: the minimum-version gate.
//
// THE HEADER. The phone sends its build number (Play's version code, `expo-application`'s
// `nativeBuildVersion`) in `x-app-build` on every call. `readAppBuild` reads it: absent is no build
// (`null`), which is admitted: the panel never sends one and no build before T184 ships; one to ten
// digits is the number; anything else (empty, a sign, a decimal, letters, eleven digits, two values,
// which Node joins with a comma) is `'invalid'`, the client's unreadable input, answered 400
// `VALIDATION_FAILED` as B19a answers an input that cannot be read, and logged as the surface logs
// every other `VALIDATION_FAILED`.
//
// THE FLOOR. A number below `min_app_build` is refused `UPDATE_REQUIRED` (426). The floor is read
// only when a number came, through the settings reader as every setting is: a read that fails is
// `SettingError`, the internal error, never 426, and is never held. A read that succeeded is held
// for `APP_BUILD_FLOOR_HOLD_MS` in the process, as the limiter's signed-in default is
// (`rate-limit.guard.ts`, `DEFAULT_LIMIT_SETTING_HOLD_MS`), so a raised floor is seen within a
// minute and no call reads the store for it more often.
//
// ONE GATE PER SETTINGS READER. The app kinds (`requireAdmittedBuild`, first in each) and the upload
// route (`admitAppBuild`) go through the same gate, the one of the process's settings reader, so the
// hold and the log's memory are one per process and no wiring is added for them; a spec's own reader
// gets its own gate.
//
// THE LOG. The first refusal per client address per hold writes one info line, `{ build, floor,
// reason: 'build_below_floor' }`, on the request's logger: its `clientAddress` binding is written as
// the address's network by the logger (R-SEC-2, `networkOf`), never as the address, as every request
// line is; the address itself is held only in this gate's memory, never logged. Later refusals of
// that address in the hold write nothing. Every refusal is marked logged
// (`platform/errors/logged-refusal.ts`), so the surface's one-place refusal log (`onError`) writes no
// second line, as it leaves a `RATE_LIMITED` to the limiter. The memory is emptied when the floor is
// read again and holds at most `APP_BUILD_REFUSALS_LOGGED_MAX` addresses, so a flood from many
// addresses cannot grow it.
import type { IncomingHttpHeaders } from 'node:http';
import { DomainError } from '../errors/domain-error.js';
import { markRefusalLogged } from '../errors/logged-refusal.js';
import type { Logger } from '../logging/logger.js';
import { MIN_APP_BUILD_SETTING, minAppBuild } from '../settings/keys.js';
import type { SettingsReader } from '../settings/settings-reader.js';

/** The header the phone's build number travels in (002:T184). */
export const APP_BUILD_HEADER = 'x-app-build';

/**
 * How long the floor is held after a read: the limiter's default's 60 s. A named constant under
 * R-MONEY-12's exception, as `DEFAULT_LIMIT_SETTING_HOLD_MS` is: a long hold set from the panel would
 * keep a raised floor unseen.
 */
export const APP_BUILD_FLOOR_HOLD_MS = 60_000;

/** The most client addresses whose refusal one hold remembers having logged. */
export const APP_BUILD_REFUSALS_LOGGED_MAX = 10_000;

/** One to ten digits: a version code, at most 2,100,000,000 on Play. */
const BUILD_NUMBER = /^\d{1,10}$/;

/** What the header carried: no header, a build number, or something that is not one. */
export type AppBuild = number | null | 'invalid';

/** The build number of a request's headers (002:T184). */
export function readAppBuild(headers: IncomingHttpHeaders): AppBuild {
  const value = headers[APP_BUILD_HEADER];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !BUILD_NUMBER.test(value)) return 'invalid';
  return Number(value);
}

/** What a check needs of its request: the request's logger and the client's address. */
export interface AppBuildRequest {
  readonly log: Logger;
  readonly clientAddress: string;
}

export class AppBuildGate {
  readonly #settings: SettingsReader;
  readonly #now: () => number;
  /** The floor and when it was read; never a failed read. */
  #held: { readonly floor: number; readonly readAt: number } | undefined;
  /** The addresses whose refusal this hold has logged. */
  readonly #logged = new Set<string>();

  constructor({
    settings,
    monotonicNow,
  }: {
    readonly settings: SettingsReader;
    /** A monotonic clock in milliseconds, for the hold; `performance.now` by default. */
    readonly monotonicNow?: () => number;
  }) {
    this.#settings = settings;
    this.#now = monotonicNow ?? (() => performance.now());
  }

  /** Admits `build`, or throws its refusal: `VALIDATION_FAILED` or `UPDATE_REQUIRED`. */
  async admit(build: AppBuild, { log, clientAddress }: AppBuildRequest): Promise<void> {
    if (build === null) return;
    if (build === 'invalid') throw new DomainError('VALIDATION_FAILED');
    const floor = await this.#floor();
    if (build >= floor) return;
    if (this.#firstInHold(clientAddress)) {
      log.info(
        { build, floor, reason: 'build_below_floor' },
        'A build below the floor was refused',
      );
    }
    throw markRefusalLogged(new DomainError('UPDATE_REQUIRED'));
  }

  /** The held floor, read again once the hold has passed; a new read opens a new hold for the log. */
  async #floor(): Promise<number> {
    const held = this.#held;
    const now = this.#now();
    if (held !== undefined && now - held.readAt < APP_BUILD_FLOOR_HOLD_MS) return held.floor;
    const floor = await this.#settings.read(MIN_APP_BUILD_SETTING, minAppBuild);
    this.#held = { floor, readAt: now };
    this.#logged.clear();
    return floor;
  }

  #firstInHold(clientAddress: string): boolean {
    if (this.#logged.has(clientAddress)) return false;
    if (this.#logged.size >= APP_BUILD_REFUSALS_LOGGED_MAX) return false;
    this.#logged.add(clientAddress);
    return true;
  }
}

/** The process's gate of each settings reader, living as long as the reader does. */
const gates = new WeakMap<SettingsReader, AppBuildGate>();

/**
 * The one check, for the app kinds and the upload route alike: `build` through the gate of
 * `settings`.
 */
export function admitAppBuild(
  build: AppBuild,
  { settings, ...request }: AppBuildRequest & { readonly settings: SettingsReader },
): Promise<void> {
  let gate = gates.get(settings);
  if (gate === undefined) {
    gate = new AppBuildGate({ settings });
    gates.set(settings, gate);
  }
  return gate.admit(build, request);
}

/** What the middleware reads of a call: the user surface's build, settings, logger and address. */
interface AdmittedBuildCall {
  readonly ctx: {
    readonly appBuild: AppBuild;
    readonly services: { readonly settings: SettingsReader };
    readonly log: Logger;
    readonly clientAddress: string;
  };
  readonly next: () => Promise<unknown>;
}

/**
 * The middleware every app kind runs first (`surfaces/procedures.ts`), never an administrator kind:
 * the request's build admitted before anything else, or refused.
 */
export function requireAdmittedBuild<TOptions extends AdmittedBuildCall>(
  options: TOptions,
): ReturnType<TOptions['next']> {
  const { appBuild, services, log, clientAddress } = options.ctx;
  const middleware = async () => {
    await admitAppBuild(appBuild, { settings: services.settings, log, clientAddress });
    return options.next();
  };
  // It answers exactly what `next` answers; an async function's declared type cannot say so.
  return middleware() as ReturnType<TOptions['next']>;
}
