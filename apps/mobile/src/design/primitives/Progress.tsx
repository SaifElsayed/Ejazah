import { View } from 'react-native';

import { useT } from '../../i18n';
import { useFormatters } from '../../lib/formatters';
import { useTheme } from '../theme';
import { Glyph } from './Icon';
import { border, media, radius, size, space } from './style';
import { Words } from './Text';

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

// ---------------------------------------------------------------------------------------------
// T032: the implementations. Progress and Meter are contracts of later phases' screens and are
// implemented with them.

export function Steps({ steps, current }: StepsProps) {
  const { color } = useTheme();
  const t = useT();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.a11y.step', { step: current + 1, total: steps.length })}
      style={{ flexDirection: 'row', gap: space['2'] }}
    >
      {steps.map((label, index) => {
        const reached = index <= current;
        return (
          <View key={label} style={{ flex: 1, gap: space['1'] }}>
            <View
              style={{
                height: size['steps-bar'],
                borderRadius: radius.full,
                backgroundColor: reached ? color.primary : color['border-strong'],
              }}
            />
            {label === '' ? null : (
              <Words
                variant="caption"
                weight={index === current ? 'bold' : 'regular'}
                color={reached ? 'primary' : 'text-muted'}
                numberOfLines={1}
              >
                {label}
              </Words>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function Timeline({ items }: TimelineProps) {
  const { color } = useTheme();
  const format = useFormatters();
  return (
    <View>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        const done = item.state === 'done';
        const current = item.state === 'current';
        return (
          <View key={item.title} style={{ flexDirection: 'row', gap: space['3'] }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: media.xs,
                  height: media.xs,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.full,
                  borderWidth: current ? border.selected : border.hairline,
                  borderColor: done || current ? color.primary : color['border-strong'],
                  backgroundColor: done
                    ? color.primary
                    : current
                      ? color['primary-subtle']
                      : color.bg,
                }}
              >
                {done ? (
                  <Glyph name="check" size="xs" stroke="heavy" color="on-primary" />
                ) : (
                  <Words variant="caption" weight="bold" color={current ? 'primary' : 'text-muted'}>
                    {format.number(index + 1)}
                  </Words>
                )}
              </View>
              {last ? null : (
                <View
                  style={{
                    flex: 1,
                    width: border.selected,
                    minHeight: space['6'],
                    backgroundColor: done ? color.primary : color['border-strong'],
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1, gap: space.half, paddingBottom: space['4'] }}>
              <Words
                weight={item.state === 'pending' ? 'medium' : 'bold'}
                color={item.state === 'pending' ? 'text-muted' : 'text'}
              >
                {item.title}
              </Words>
              {item.meta === undefined ? null : (
                <Words variant="caption" color="text-muted">
                  {item.meta}
                </Words>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
