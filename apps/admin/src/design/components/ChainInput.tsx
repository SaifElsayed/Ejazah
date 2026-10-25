// T072: ChainInput, one generation of a chain in the transcription (`AdminCredentials`, the design's
// `.chain-input` row): its number in a round tile, its names as removable chips, «+ اسم» that opens
// a field in the row (Enter adds the name and keeps the field for the next, Escape or leaving it
// closes it), and the generation's removal. A generation the correction changed has its number
// marked (`AdminCredentialCorrect`). The board's drag handle is not drawn: the generations are not
// reordered by dragging (B14c, the owner's decision).
import clsx from 'clsx';
import { useState } from 'react';

import { useT } from '../../i18n';
import { Button, IconButton } from './Button';
import { Chip } from './Selection';

export interface ChainInputProps {
  /** The generation's place, from the origin (1). */
  readonly position: number;
  readonly names: readonly string[];
  /** Changed by the correction: the number is marked. */
  readonly changed?: boolean;
  /** A name typed in the row, trimmed and never empty. */
  readonly onAddName: (name: string) => void;
  readonly onRemoveName: (index: number) => void;
  readonly onRemove: () => void;
}

export function ChainInput({
  position,
  names,
  changed = false,
  onAddName,
  onRemoveName,
  onRemove,
}: ChainInputProps) {
  const t = useT();
  const [typing, setTyping] = useState<string | null>(null);
  const add = () => {
    const name = (typing ?? '').trim();
    if (name !== '') onAddName(name);
    setTyping('');
  };
  return (
    <li className="chain-input shrink-0">
      <span
        className={clsx(
          'icon-tile icon-tile--sm icon-tile--round',
          changed ? 'icon-tile--primary' : 'icon-tile--neutral',
        )}
      >
        {position}
      </span>
      <span className="row wrap gap-2 grow">
        {names.map((name, index) => (
          <Chip
            key={`${index}-${name}`}
            label={name}
            removable
            accessibilityLabel={t('admin.credentials.a11y.removeName', { name })}
            onPress={() => onRemoveName(index)}
          />
        ))}
        {typing === null ? (
          <Button
            label={t('admin.credentials.panel.addName')}
            variant="ghost"
            icon={{ name: 'plus', size: 'sm' }}
            onPress={() => setTyping('')}
          />
        ) : (
          <input
            className="chain-input__control"
            aria-label={t('admin.credentials.panel.generationNameLabel', { n: position })}
            value={typing}
            // The field opens on the reviewer's own press, so it takes the focus.
            autoFocus
            onChange={(event) => setTyping(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              } else if (event.key === 'Escape') {
                setTyping(null);
              }
            }}
            onBlur={() => {
              const name = (typing ?? '').trim();
              if (name !== '') onAddName(name);
              setTyping(null);
            }}
          />
        )}
      </span>
      <IconButton
        icon={{ name: 'trash' }}
        variant="muted"
        accessibilityLabel={t('admin.credentials.a11y.deleteGeneration', { n: position })}
        onPress={onRemove}
      />
    </li>
  );
}
