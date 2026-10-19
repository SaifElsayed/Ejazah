// T040 (FR-128, research R-105): the password bounds, here and nowhere else. At least eight
// characters, at most 128 (the cap keeps the Argon2id call bounded), and no composition rule:
// NIST SP 800-63B forbids one, and the owner kept it so on 2026-10-19. The server also refuses a
// password on the bundled breached list (`apps/api/src/platform/crypto/breached-passwords`).
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** A password: length only, no composition rule; the breached check is the service's (FR-128). */
export const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
