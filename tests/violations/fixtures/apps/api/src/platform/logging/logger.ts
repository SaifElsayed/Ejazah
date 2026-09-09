// T026 fixture support — the structured logger a request handler is supposed to call
// (R-SEC-2, FR-040). Declarations only: the R-SEC-2 fixture needs a real logger to reference so
// the violation is what it passes, not a missing import. The real one is T100's.
export interface Logger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export declare const logger: Logger;
