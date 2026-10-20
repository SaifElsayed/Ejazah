// T036: Icon. The drawing behind every name of the registry (`icons.ts`): seventy are Lucide's,
// imported one by one so the bundle carries only these; the two brand marks are drawn here as the
// registry draws them, Google's four colours from its brand tokens. The `satisfies` clause refuses a
// registry name without a drawing, so a new icon fails the typecheck until it is mapped here.
// Size, stroke, fill and the mirroring of a directional icon are components.css classes (`.icon`,
// `.icon--<size>`, `.icon--medium`, `.icon--filled`, `[dir="rtl"] .icon--flip`), never inline.
import clsx from 'clsx';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Award,
  Ban,
  Bell,
  BellOff,
  Book,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  CreditCard,
  Download,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  Filter,
  Flag,
  Globe,
  GripVertical,
  Hourglass,
  House,
  Info,
  KeyRound,
  Landmark,
  Layers,
  Link,
  List,
  Lock,
  LogOut,
  type LucideIcon,
  Mail,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Pencil,
  PenLine,
  PhoneOff,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Share,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Star,
  Trash,
  TriangleAlert,
  Upload,
  User,
  UserCheck,
  Users,
  UserX,
  Video,
  VideoOff,
  WifiOff,
  X,
} from 'lucide-react';

import { directionalIcons, type IconName } from '../icons';
import type { Accessible, IconSpec, Tone } from './types';

const lucideGlyphs = {
  'shield-check': ShieldCheck,
  users: Users,
  mail: Mail,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  'arrow-left': ArrowLeft,
  eye: Eye,
  clock: Clock,
  book: Book,
  award: Award,
  'alert-circle': AlertCircle,
  bell: Bell,
  house: House,
  search: Search,
  user: User,
  check: Check,
  upload: Upload,
  x: X,
  lock: Lock,
  star: Star,
  'credit-card': CreditCard,
  smartphone: Smartphone,
  'qr-code': QrCode,
  file: File,
  download: Download,
  calendar: Calendar,
  layers: Layers,
  plus: Plus,
  'grip-vertical': GripVertical,
  landmark: Landmark,
  mic: Mic,
  'video-off': VideoOff,
  'message-square': MessageSquare,
  'phone-off': PhoneOff,
  paperclip: Paperclip,
  trash: Trash,
  'user-check': UserCheck,
  flag: Flag,
  'sliders-horizontal': SlidersHorizontal,
  list: List,
  'log-out': LogOut,
  filter: Filter,
  'external-link': ExternalLink,
  activity: Activity,
  ban: Ban,
  'chevron-down': ChevronDown,
  pencil: Pencil,
  'pen-line': PenLine,
  'wifi-off': WifiOff,
  video: Video,
  'mic-off': MicOff,
  'refresh-cw': RefreshCw,
  info: Info,
  'file-text': FileText,
  'triangle-alert': TriangleAlert,
  'eye-off': EyeOff,
  'user-x': UserX,
  'rotate-ccw': RotateCcw,
  globe: Globe,
  share: Share,
  'key-round': KeyRound,
  hourglass: Hourglass,
  'circle-check': CircleCheck,
  'circle-x': CircleX,
  scale: Scale,
  copy: Copy,
  'ellipsis-vertical': EllipsisVertical,
  'bell-off': BellOff,
  link: Link,
} as const satisfies Record<Exclude<IconName, 'apple' | 'google'>, LucideIcon>;

const APPLE =
  'M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.65-.39 6.58 1.1 8.73.73 1.05 1.6 2.23 2.73 2.19 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.49zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21z';

const GOOGLE: readonly (readonly [string, string])[] = [
  [
    'var(--color-brand-google-blue)',
    'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z',
  ],
  [
    'var(--color-brand-google-green)',
    'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z',
  ],
  [
    'var(--color-brand-google-yellow)',
    'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z',
  ],
  [
    'var(--color-brand-google-red)',
    'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z',
  ],
];

const directional: ReadonlySet<IconName> = new Set(directionalIcons);

export interface IconProps extends IconSpec, Accessible {
  /** The colour role; by default the icon takes its parent's colour. */
  readonly tone?: Tone;
}

/**
 * An inline icon at a token size. Decorative by default (hidden from the screen reader); a label
 * makes it announced. A directional icon carries `icon--flip`, which mirrors it right to left.
 */
export function Icon({
  name,
  size = 'md',
  stroke = 'regular',
  fill = 'none',
  tone,
  accessibilityLabel,
}: IconProps) {
  const className = clsx(
    'icon',
    `icon--${size}`,
    stroke !== 'regular' && `icon--${stroke}`,
    fill !== 'none' && `icon--${fill}`,
    directional.has(name) && 'icon--flip',
    tone !== undefined && `tone-${tone}`,
  );
  const announced =
    accessibilityLabel === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': accessibilityLabel } as const);
  if (name === 'apple' || name === 'google') {
    return (
      <svg className={className} viewBox="0 0 24 24" stroke="none" {...announced}>
        {name === 'apple' ? (
          <path d={APPLE} fill="var(--color-brand-apple)" />
        ) : (
          GOOGLE.map(([colour, d]) => <path key={colour} d={d} fill={colour} />)
        )}
      </svg>
    );
  }
  const Drawing = lucideGlyphs[name];
  return <Drawing className={className} {...announced} />;
}
