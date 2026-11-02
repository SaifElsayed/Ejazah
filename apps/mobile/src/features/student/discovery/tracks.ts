// T029: a track's name on the cards, the filter and its chip (FR-334, FR-335).
import type { PackageTrack } from '@ijazah/contracts';

import type { MessageKey } from '../../../i18n';

export const TRACKS: readonly PackageTrack[] = ['recitation', 'ijazah_track'];

export const TRACK_LABEL: Readonly<Record<PackageTrack, MessageKey>> = {
  recitation: 'common.track.recitation',
  ijazah_track: 'common.track.ijazahTrack',
};
