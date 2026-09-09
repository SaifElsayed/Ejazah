// T022 fixture — VIOLATION of R-MOBILE-8: a sentence assembled from translated fragments.
// Concatenation fixes the order of the parts, which is exactly what RTL and Arabic grammar
// need to be free to change; one key with interpolation is the only correct form.
// Refused by mobile/no-translated-concat.
import { t } from '../../i18n';

export function greeting(): string {
  return t('shared.greeting.hello') + t('shared.greeting.name');
}
