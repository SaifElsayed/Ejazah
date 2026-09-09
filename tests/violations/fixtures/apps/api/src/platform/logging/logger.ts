// T026 fixture support — declarations only, so the R-SEC-2 fixture has a real logger to call and
// its violation is what it passes rather than a missing import. The real one is T100's.
export interface Logger {
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

export declare const logger: Logger;
