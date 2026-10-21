// T050: two pieces the sign-in screens share: the announced error line under a field
// (EmailSignInError: `.field__error` with the alert icon, `role="alert"`), and the resend countdown
// of a sent code («إعادة الإرسال بعد {time}», an action once it ends).
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Icon, Text, TextLink } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';

/** The error line under a field, read out as soon as it appears. */
export function FieldAlert({ message }: { readonly message: string }) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['2'] }}
    >
      <Icon name="alert-circle" size="sm" tone="danger" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="caption" tone="danger">
          {message}
        </Text>
      </View>
    </View>
  );
}

/** How long a sent code waits before another may be asked for (the boards' «0:59»). */
export const RESEND_AFTER_SECONDS = 60;

const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;
/** Below it a seconds count is written with a leading zero («0:09»). */
const TWO_DIGITS = 10;

/** Seconds left before a resend; `restart` starts the wait again after a resend. */
export function useCountdown(seconds: number = RESEND_AFTER_SECONDS) {
  const [left, setLeft] = useState(seconds);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setLeft(seconds);
    const timer = setInterval(() => {
      setLeft((now) => {
        if (now <= 1) clearInterval(timer);
        return Math.max(0, now - 1);
      });
    }, SECOND_MS);
    return () => clearInterval(timer);
  }, [seconds, round]);
  return { left, restart: () => setRound((value) => value + 1) };
}

/** The countdown as «0:59», then the resend action. */
export function Resend({
  left,
  waitingKey,
  onResend,
}: {
  readonly left: number;
  readonly waitingKey: Extract<MessageKey, 'auth.otp.resendIn' | 'auth.resetPassword.resendIn'>;
  readonly onResend: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  if (left === 0) return <TextLink label={t('auth.otp.resend')} onPress={onResend} />;
  const minutes = Math.floor(left / SECONDS_PER_MINUTE);
  const seconds = left % SECONDS_PER_MINUTE;
  const time = `${format.number(minutes)}:${seconds < TWO_DIGITS ? format.number(0) : ''}${format.number(seconds)}`;
  return (
    <Text variant="caption" tone="muted" align="center">
      {t(waitingKey, { time })}
    </Text>
  );
}
