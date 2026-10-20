// T036: Steps, Timeline, Meter (docs/design/components.md, "Primitives"; design `.steps`,
// `.timeline`, `.meter`).
import clsx from 'clsx';

import { Icon } from './Icon';

export interface StepsProps {
  readonly steps: readonly string[];
  /** The index of the current step; the ones before it are done. */
  readonly current: number;
}

export function Steps({ steps, current }: StepsProps) {
  return (
    <ol className="steps">
      {steps.map((step, index) => (
        <li
          key={step}
          className={clsx(
            'steps__item',
            index < current && 'steps__item--done',
            index === current && 'steps__item--current',
          )}
          aria-current={index === current ? 'step' : undefined}
        >
          <span className="steps__bar" />
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export interface TimelineProps {
  readonly items: readonly {
    readonly title: string;
    readonly meta?: string;
    readonly state: 'done' | 'current' | 'pending';
  }[];
}

/** A status moving through its stages; a line joins each stage to the next. */
export function Timeline({ items }: TimelineProps) {
  return (
    <ol className="timeline">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <li
            key={item.title}
            className={clsx(
              'timeline__item',
              item.state === 'pending' && 'timeline__item--pending',
            )}
          >
            <span className="timeline__rail">
              <span
                className={clsx(
                  'timeline__marker',
                  item.state !== 'pending' && `timeline__marker--${item.state}`,
                )}
              >
                {item.state === 'done' ? <Icon name="check" size="xs" stroke="heavy" /> : null}
              </span>
              {last ? null : (
                <span
                  className={clsx(
                    'timeline__line',
                    item.state === 'done' && 'timeline__line--done',
                  )}
                />
              )}
            </span>
            <span className="timeline__body">
              <strong className="timeline__title">{item.title}</strong>
              {item.meta === undefined ? null : <span className="timeline__meta">{item.meta}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface MeterProps {
  /** Percent, 0 to 100. */
  readonly value: number;
  /** Percent, 0 to 100: the mark, and the line below which the fill is low. */
  readonly threshold: number;
  readonly accessibilityLabel: string;
}

const percent = (value: number) => `${Math.min(100, Math.max(0, value))}%`;

/**
 * A value against a threshold. The fill's width and the mark's position are the data, the one
 * inline style the design allows (`.meter` in components.css), measured from the start.
 */
export function Meter({ value, threshold, accessibilityLabel }: MeterProps) {
  return (
    <div className="meter" role="img" aria-label={accessibilityLabel}>
      <span
        className={clsx('meter__fill', value < threshold && 'meter__fill--low')}
        style={{ width: percent(value) }}
      />
      <span className="meter__mark" style={{ insetInlineStart: percent(threshold) }} />
    </div>
  );
}
