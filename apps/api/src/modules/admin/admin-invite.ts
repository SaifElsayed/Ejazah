// T066 (FR-174, research R-110): the administrator's invite. The link carries a stateless token
// signed under `ijazah:admin-invite:v1`:
//
//   v1.<admin id>.<expiry>.<HMAC-SHA256 of the first three parts, base64url>
//
// its expiry `admin_invite_ttl_hours` after the invitation (`invited_at`), so one invitation always
// yields the same link, whenever and however often the `deliver-admin-invite` job prepares it. It is
// single use by `password_set_at`: `auth.setPassword` sets the password only where none was set. The
// token sits in the link's fragment (`/set-password#token=…`), which a browser never sends to a
// server, so it reaches no access log and no referrer.
//
// The mail is the identity module's (R-110: the mails' words live there), in both languages, since an
// administrator has no language column. `prepare` answers null for an administrator who needs no link
// (the password set, the account disabled, never invited, or the link's lifetime gone) and throws for
// one that is not there, which is the job running before the adding transaction committed: the queue
// tries it again.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { addHours } from '@ijazah/time';
import { z } from 'zod';

import { ADMIN_INVITE_LABEL, deriveSubkey } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { renderAdminInviteMail } from '../identity/index.js';
import { AdminUsersRepository } from './admin-users.repository.js';

export const INVITE_TTL_SETTING = 'admin_invite_ttl_hours';

const VERSION = 'v1';
const positiveWhole = z.int().positive();
const SET_PASSWORD_PATH = '/set-password';

export interface AdminInviteDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly encryptionKey: string;
  /** The panel's origin, scheme and host (`ADMIN_PANEL_ORIGIN`); unset, no invite can be sent. */
  readonly panelOrigin: string | undefined;
  readonly now?: () => Date;
}

/** An invite ready to send: the address, the mail, the link, and the mark that it went. */
export interface PreparedAdminInvite {
  readonly to: string;
  readonly mail: { readonly subject: string; readonly text: string };
  readonly link: string;
  /** The SHA-256 of the token, naming the delivery without carrying the token. */
  readonly mark: string;
  readonly expiresAt: Date;
}

/** Signs and reads the invite token. */
export class InviteTokens {
  readonly #key: Buffer;

  constructor(encryptionKey: string) {
    this.#key = deriveSubkey(encryptionKey, ADMIN_INVITE_LABEL);
  }

  mint(adminId: string, expiry: string): string {
    const body = `${VERSION}.${adminId}.${expiry}`;
    return `${body}.${this.#mac(body)}`;
  }

  /** The administrator and the expiry a well-signed token names, or null. */
  read(token: string): { readonly adminId: string; readonly expiry: string } | null {
    const [version, adminId = '', expiry = '', mac = '', ...extra] = token.split('.');
    if (version !== VERSION || extra.length > 0) return null;
    const expected = Buffer.from(this.#mac(`${VERSION}.${adminId}.${expiry}`));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    return { adminId, expiry };
  }

  #mac(body: string): string {
    return createHmac('sha256', this.#key).update(body).digest('base64url');
  }
}

export class AdminInvites {
  readonly #administrators: AdminUsersRepository;
  readonly #settings: SettingsReader;
  readonly #tokens: InviteTokens;
  readonly #panelOrigin: string | undefined;
  readonly #now: () => Date;

  constructor(dependencies: AdminInviteDependencies) {
    this.#administrators = new AdminUsersRepository(dependencies.database);
    this.#settings = dependencies.settings;
    this.#tokens = new InviteTokens(dependencies.encryptionKey);
    this.#panelOrigin = dependencies.panelOrigin;
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** The invite of `adminId`, or null when none is needed; throws when the row is not there. */
  async prepare(adminId: string): Promise<PreparedAdminInvite | null> {
    const admin = await this.#administrators.findById(adminId);
    if (admin === null) throw new Error(`deliver-admin-invite: administrator ${adminId} not found`);
    if (this.#panelOrigin === undefined) {
      throw new Error('deliver-admin-invite: ADMIN_PANEL_ORIGIN is not set, so the link has nowhere to point');
    }
    if (!admin.isActive || admin.passwordSetAt !== null || admin.invitedAt === null) return null;
    const hours = await this.#settings.read(INVITE_TTL_SETTING, positiveWhole);
    const expiry = addHours(admin.invitedAt, hours);
    const expiresAt = new Date(expiry);
    if (expiresAt <= this.#now()) return null;
    const token = this.#tokens.mint(admin.id, expiry);
    const link = `${this.#panelOrigin}${SET_PASSWORD_PATH}#token=${token}`;
    return {
      to: admin.email,
      mail: renderAdminInviteMail({ displayName: admin.displayName, link, hours }),
      link,
      mark: createHash('sha256').update(token, 'utf8').digest('hex'),
      expiresAt,
    };
  }
}
