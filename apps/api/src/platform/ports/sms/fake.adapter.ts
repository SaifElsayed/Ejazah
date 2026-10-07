// T120: the messaging stand-in. It checks what it is handed and sends nothing, and it writes
// nothing anywhere, so a one-time code never reaches a log (R-SEC-2). Recording calls and induced
// failure are T122's.
import { assertMessage, type SmsPort } from './sms.port.js';

export class FakeSmsAdapter implements SmsPort {
  send(destination: string, text: string): Promise<void> {
    try {
      assertMessage(destination, text);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    return Promise.resolve();
  }
}
