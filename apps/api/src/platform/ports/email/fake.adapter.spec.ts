// T023 — the email port and its stand-in (specs/002-identity/contracts/ports.md "EmailPort",
// research R-110, R-SEC-2). One operation, `deliver`, taking a rendered mail to one address: a
// subject, a text body and an optional HTML body, never a template id, so no vendor concept
// enters the port (R-API-5). The body may carry a one-time code, so the stand-in logs nothing of
// it; it records every mail so a test can read the code it carried, fails a delivery when told
// (T122), and in development writes each mail to a folder so the owner can read a code on a
// device walk-through.
//
// The type check is enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { StandInFailure } from '../stand-in.js';
import { type EmailPort, type Mail } from './email.port.js';
import { FakeEmailAdapter } from './fake.adapter.js';

const FROM = 'no-reply@ijazah.invalid';

const mail: Mail = {
  to: 'amr.k@example.invalid',
  subject: 'رمز الدخول',
  text: 'رمز الدخول هو 482913',
};

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ijazah-mail-'));
  directories.push(directory);
  return join(directory, 'mail');
}

describe('the email port (T023, R-API-5)', () => {
  it('has one operation: deliver a rendered mail to one address', () => {
    expectTypeOf<keyof EmailPort>().toEqualTypeOf<'deliver'>();
    expectTypeOf<EmailPort['deliver']>().toEqualTypeOf<(mail: Mail) => Promise<void>>();
    expectTypeOf<Mail>().toEqualTypeOf<{
      readonly to: string;
      readonly subject: string;
      readonly text: string;
      readonly html?: string;
    }>();
  });
});

describe('the email stand-in (T023)', () => {
  it('delivers a mail to one address, recording the sender it was configured with', async () => {
    const email = new FakeEmailAdapter({ from: FROM });
    await expect(email.deliver(mail)).resolves.toBeUndefined();
    expect(email.from).toBe(FROM);
  });

  it.each([
    ['two addresses', 'a@example.invalid, b@example.invalid'],
    ['a display name', 'Amr <a@example.invalid>'],
    ['no domain', 'amr'],
    ['a space', 'a mr@example.invalid'],
    ['nothing', ''],
  ])('refuses %s as the address', async (_name, to) => {
    await expect(new FakeEmailAdapter({ from: FROM }).deliver({ ...mail, to })).rejects.toThrow(
      RangeError,
    );
  });

  it('refuses an empty subject and an empty text', async () => {
    const email = new FakeEmailAdapter({ from: FROM });
    await expect(email.deliver({ ...mail, subject: '' })).rejects.toThrow(RangeError);
    await expect(email.deliver({ ...mail, text: '' })).rejects.toThrow(RangeError);
  });

  it('writes nothing to the console or the process streams, so a code never reaches a log', async () => {
    const writes = [
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method),
      ),
    ];
    const email = new FakeEmailAdapter({ from: FROM, mailDirectory: await temporaryDirectory() });
    await email.deliver({ ...mail, html: '<p>482913</p>' });
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it('writes each mail to the folder it is given, so the owner can read a code in development', async () => {
    const mailDirectory = await temporaryDirectory();
    const email = new FakeEmailAdapter({ from: FROM, mailDirectory });
    await email.deliver(mail);
    await email.deliver({
      ...mail,
      subject: 'ثانية',
      text: 'رمز آخر 117733',
      html: '<b>117733</b>',
    });

    const files = (await readdir(mailDirectory)).sort();
    expect(files).toHaveLength(2);
    const first = await readFile(join(mailDirectory, files[0] ?? ''), 'utf8');
    expect(first).toContain(`From: ${FROM}`);
    expect(first).toContain('To: amr.k@example.invalid');
    expect(first).toContain('Subject: رمز الدخول');
    expect(first).toContain('482913');
    const second = await readFile(join(mailDirectory, files[1] ?? ''), 'utf8');
    expect(second).toContain('117733');
    expect(second).toContain('<b>117733</b>');
  });

  it('writes no file when it is given no folder (every test run)', async () => {
    const parent = await temporaryDirectory();
    const email = new FakeEmailAdapter({ from: FROM });
    await email.deliver(mail);
    await expect(readdir(parent)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('the email stand-in: records and induced failure (T122)', () => {
  it('records each mail it was asked to deliver, so a test can read the code it carried', async () => {
    const email = new FakeEmailAdapter({ from: FROM });
    await email.deliver(mail);
    expect(email.calls).toEqual([{ operation: 'deliver', args: [mail] }]);
    const [first] = email.calls;
    expect(first?.args[0].text).toContain('482913');
  });

  it('fails a delivery when told, then delivers again', async () => {
    const email = new FakeEmailAdapter({ from: FROM });
    email.failNext('deliver');
    await expect(email.deliver(mail)).rejects.toThrow(StandInFailure);
    await expect(email.deliver(mail)).resolves.toBeUndefined();
  });

  it('records a refused mail too', async () => {
    const email = new FakeEmailAdapter({ from: FROM });
    await expect(email.deliver({ ...mail, to: 'amr' })).rejects.toThrow(RangeError);
    expect(email.calls).toHaveLength(1);
  });
});
