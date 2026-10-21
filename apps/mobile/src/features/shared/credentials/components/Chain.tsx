// T059 (FR-ISNAD-1, FR-ISNAD-5, ADR 0017 D1): a credential's chain of transmission, read-only, as an
// administrator transcribed it from the ijazah: origin first, one generation per line holding one or
// more names, and the holder last, in bold. A long chain keeps its first and last generations and
// folds the middle into «… {n} جيلًا», as the board draws it. Shared: the student will read a
// teacher's chain from the profile in a later phase.
import { View } from 'react-native';

import { Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';

/** How many generations are shown at each end before the middle folds. */
const SHOWN_AT_EACH_END = 2;

export interface ChainGeneration {
  readonly position: number;
  readonly names: readonly string[];
}

export function Chain({
  generations,
  holder,
}: {
  readonly generations: readonly ChainGeneration[];
  /** The ijazah's holder, the chain's last link. */
  readonly holder?: string;
}) {
  const t = useT();
  const folds = generations.length > SHOWN_AT_EACH_END * 2 + 1;
  const first = folds ? generations.slice(0, SHOWN_AT_EACH_END) : generations;
  const last = folds ? generations.slice(-SHOWN_AT_EACH_END) : [];
  const folded = generations.length - first.length - last.length;
  const line = (generation: ChainGeneration) => (
    <Text key={generation.position} variant="callout">
      {generation.names.join(t('teacher.credentials.chainNamesSeparator'))}
    </Text>
  );
  return (
    <View
      accessibilityLabel={t('teacher.credentials.a11y.chain')}
      style={{ gap: tokens.space['1'] }}
    >
      {first.map(line)}
      {folds ? (
        <Text variant="callout" tone="muted">
          {t('teacher.credentials.chainMore', { count: folded })}
        </Text>
      ) : null}
      {last.map(line)}
      {holder === undefined ? null : (
        <Text variant="callout" weight="bold">
          {holder}
        </Text>
      )}
    </View>
  );
}
