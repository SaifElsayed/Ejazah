// T120: the messaging stand-in. It checks what it is handed and sends nothing, and it writes
// nothing anywhere, so a one-time code never reaches a log (R-SEC-2). T122: it records each message
// in memory, so a test can read the code it carried, and fails a send when told.
import { StandIn } from '../stand-in.js';
import { assertMessage, type SmsPort } from './sms.port.js';

export class FakeSmsAdapter extends StandIn<SmsPort> implements SmsPort {
  send(destination: string, text: string): Promise<void> {
    const failure = this.attempt('send', [destination, text]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      assertMessage(destination, text);
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
    return Promise.resolve();
  }
}
