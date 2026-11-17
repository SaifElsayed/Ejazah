// T038: the `platform` namespace of the user surface (app-surface.md "`platform` and `catalog`";
// FR-145, ADR 0021 D4): the public configuration the apps read at start-up and cache.
import { z } from 'zod';

/** One email address, as the wire carries it; lower-casing is the service's. */
export const emailAddress = z.email();

/** The version of the Terms a person accepts: the `terms_version` setting's value (FR-127). */
export const termsVersion = z.string().min(1).max(32);

/** A whole number of seconds or minutes a setting holds, at least one. */
const settingCount = z.int().positive();

/**
 * The numbers the phone reads a pending checkout by (T002, FR-383), each from its setting:
 * Processing reads every `processingPollSeconds` until `confirmationTimeoutSeconds`; Confirming
 * reads every `confirmingPollSeconds` for at most `confirmingPollWindowMinutes`.
 */
export const checkoutPolling = z.object({
  confirmationTimeoutSeconds: settingCount,
  processingPollSeconds: settingCount,
  confirmingPollSeconds: settingCount,
  confirmingPollWindowMinutes: settingCount,
});

/**
 * 003:T104 (ADR 0025 D1, SRS DEC-80, §3.14): the teacher's share of each gateway order, a whole
 * percent from 0 to 100, an administrator's setting. Not secret: the Terms state the commission.
 */
export const teacherSharePercent = z.int().min(0).max(100);

/**
 * `platform.publicConfig`'s answer: the support address, the current Terms version, (T002) the
 * checkout numbers, and (003:T104, Q-A3 (a)) the teacher's share rate the package editor shows the
 * share by while the price is typed.
 */
export const publicConfigOutput = z.object({
  supportEmail: emailAddress,
  termsVersion,
  checkout: checkoutPolling,
  teacherSharePercent,
});

export type PublicConfig = z.infer<typeof publicConfigOutput>;
