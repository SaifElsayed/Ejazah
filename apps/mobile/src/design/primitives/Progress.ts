/**
 * Steps: where the user is in a flow, one bar per step, labels optional. Design: `.steps`,
 * `.steps__item--done|current`.
 */
export interface StepsProps {
  readonly steps: readonly string[];
  /** Zero-based index of the current step; earlier steps are done. */
  readonly current: number;
}

/**
 * Progress: sessions consumed out of the package: one segment per session (packages up to 12),
 * or one bar when `segments` is false. Design: `.progress`, `.progress__seg--done`.
 */
export interface ProgressProps {
  readonly done: number;
  readonly total: number;
  readonly segments?: boolean;
}

/**
 * Timeline: a status that moves through stages (an application, a payout account). Design:
 * `.timeline`, `.timeline__marker--done|current|pending`.
 */
export interface TimelineProps {
  readonly items: readonly {
    readonly title: string;
    readonly meta?: string;
    readonly state: 'done' | 'current' | 'pending';
  }[];
}

/**
 * Meter: connected time against the attendance threshold; the fill width is the data value and
 * the mark is the threshold. Design: `.meter`, `.meter__fill--low`, `.meter__mark`.
 */
export interface MeterProps {
  /** 0 to 1. */
  readonly value: number;
  /** 0 to 1; the fill turns warning below it. */
  readonly threshold: number;
  readonly accessibilityLabel: string;
}
