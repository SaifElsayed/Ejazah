// T027 fixture support — the push port a module is allowed to see (R-API-4: the port, never the
// adapter). Declarations only, mirroring apps/api/src/platform/ports/push/push.port.ts: a fixture
// needs a `send` to call, not a working transport. The payload carries identifiers only (R-HONEST-5).
export interface PushPort {
  send(userId: string, payload: { readonly kind: string; readonly id: string }): Promise<void>;
}

export declare const push: PushPort;
