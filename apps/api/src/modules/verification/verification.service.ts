// T024: the verification module's rules around a stored document (FR-151, NFR-SEC-3, R-SEC-3,
// R-DB-8). A document is reached only by a signed link that expires, minted here on demand for
// the person who uploaded it or an administrator and refused to anyone else; the link lives
// `document_link_ttl_seconds`, read through the settings reader on every call (FR-034). The storage
// key is decrypted from the row for the one call that needs it and never leaves this service.
import { addSeconds, type UtcInstant } from '@ijazah/time';
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { DOCUMENT_STORAGE_KEY_COLUMN, readDocument } from './verification.repository.js';

export { DOCUMENT_LINK_TTL_SETTING };

/** Who asks for a link: the owner by their user id, or an administrator. */
export type DocumentViewer =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'admin'; readonly adminId: string };

export interface DocumentLink {
  readonly url: string;
  readonly expiresAt: UtcInstant;
}

export interface VerificationServiceDependencies {
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly settings: SettingsReader;
  readonly clock?: () => Date;
}

export class VerificationService {
  readonly #storage: Pick<StoragePort, 'temporaryLink'>;
  readonly #cipher: Pick<ColumnCipher, 'decrypt'>;
  readonly #settings: SettingsReader;
  readonly #clock: () => Date;

  constructor({
    storage,
    cipher,
    settings,
    clock = () => new Date(),
  }: VerificationServiceDependencies) {
    this.#storage = storage;
    this.#cipher = cipher;
    this.#settings = settings;
    this.#clock = clock;
  }

  /**
   * A signed, expiring link to the document, for its owner or an administrator (FR-151). A
   * document that does not exist is `NOT_FOUND` to anyone; another person's is
   * `DOCUMENT_NOT_OWNED`, and no link is minted.
   */
  async documentLinkFor(
    tx: Pick<Transaction, 'verificationDocument'>,
    documentId: string,
    viewer: DocumentViewer,
  ): Promise<DocumentLink> {
    const document = await readDocument(tx, documentId);
    if (document === null) throw new DomainError('NOT_FOUND');
    if (viewer.kind === 'user' && document.userId !== viewer.userId) {
      throw new DomainError('DOCUMENT_NOT_OWNED');
    }
    const key = this.#cipher.decrypt(
      document.storageKeyEncrypted,
      DOCUMENT_STORAGE_KEY_COLUMN,
      document.id,
    );
    const ttl = await this.#settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
    const url = await this.#storage.temporaryLink(key, ttl);
    return { url, expiresAt: addSeconds(this.#clock(), ttl) };
  }
}
