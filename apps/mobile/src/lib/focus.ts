// T015 (R-217, FR-383): whether the app is in the foreground, as the query cache knows it. AppState
// drives TanStack Query's `focusManager` (TanStack's React Native guide), so a query whose data is
// stale reads again when the person comes back to the app: an enrollment awaiting payment or
// confirming is read again on every return to the foreground.
import { focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

/**
 * Lets AppState tell the query cache when the app comes to the foreground. Only `active` counts as
 * focused: `inactive` (iOS's app switcher, a system sheet) and `background` do not, and the move
 * back to `active` is what reads the stale queries again.
 */
export function followAppState(): void {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status) =>
      setFocused(status === 'active'),
    );
    return () => subscription.remove();
  });
}
