// T038: the `platform` namespace of the user surface (app-surface.md "`platform` and `catalog`";
// FR-145, ADR 0021 D4): the public configuration the apps read at start-up and cache.
import { z } from 'zod';

/** One email address, as the wire carries it; lower-casing is the service's. */
export const emailAddress = z.email();

/** The version of the Terms a person accepts: the `terms_version` setting's value (FR-127). */
export const termsVersion = z.string().min(1).max(32);

/** `platform.publicConfig`'s answer: the support address and the current Terms version. */
export const publicConfigOutput = z.object({
  supportEmail: emailAddress,
  termsVersion,
});

export type PublicConfig = z.infer<typeof publicConfigOutput>;
