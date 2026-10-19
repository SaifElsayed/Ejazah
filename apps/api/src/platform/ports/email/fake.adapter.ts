// T023: the email stand-in (contracts/ports.md "Stand-in behaviour"). It checks what it is handed
// and sends nothing; it logs nothing of the body, so a one-time code never reaches a log (R-SEC-2).
// T122: it records each mail in memory, so a test can read the code it carried, and fails a
// delivery when told.
//
// In development only, the entry hands it a folder (`<STORAGE_LOCAL_ROOT>/mail/`, under the
// ignored `.storage/`), and it writes each mail there as a plain-text file, so the owner can read a
// code on a device walk-through. A test run hands it no folder, so no test writes a mail anywhere.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StandIn } from '../stand-in.js';
import { assertMail, type EmailPort, type Mail } from './email.port.js';

export interface FakeEmailOptions {
  /** `EMAIL_FROM`: the sender the stand-in records. */
  readonly from: string;
  /** The folder each mail is written to; development only. */
  readonly mailDirectory?: string;
}

/** The file a mail is written as: the headers, the text, then the HTML when there is one. */
function fileOf(from: string, mail: Mail): string {
  const head = [`From: ${from}`, `To: ${mail.to}`, `Subject: ${mail.subject}`].join('\n');
  const html = mail.html === undefined ? '' : `\n\n--- html ---\n${mail.html}\n`;
  return `${head}\n\n${mail.text}\n${html}`;
}

export class FakeEmailAdapter extends StandIn<EmailPort> implements EmailPort {
  readonly from: string;
  readonly #mailDirectory: string | undefined;
  #written = 0;

  constructor({ from, mailDirectory }: FakeEmailOptions) {
    super();
    this.from = from;
    this.#mailDirectory = mailDirectory;
  }

  async deliver(mail: Mail): Promise<void> {
    const failure = this.attempt('deliver', [mail]);
    if (failure !== undefined) throw failure;
    assertMail(mail);
    if (this.#mailDirectory === undefined) return;
    this.#written += 1;
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${this.#written}.txt`;
    await mkdir(this.#mailDirectory, { recursive: true });
    await writeFile(join(this.#mailDirectory, name), fileOf(this.from, mail), 'utf8');
  }
}
