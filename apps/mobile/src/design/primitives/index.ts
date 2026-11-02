// The primitives (ARCHITECTURE §6.3, docs/design/components.md, ADR 0020). Features compose
// primitives; they do not build buttons (R-MOBILE-6). Each file holds a contract group: the props a
// primitive accepts and the decisions it refuses to delegate, and since T032 the primitive itself,
// implemented against those types without widening them. StarInput, Rating, SignaturePad, Progress
// and Meter are contracts only until the screens of their phase implement them; Slot, CategoryTabs,
// Stats and FilterChips came with T014. A `Pressable` whose `style` is a function carries
// `cssInterop={false}`: NativeWind's JSX runtime drops such a style (nativewind/nativewind#1128,
// T102), and `__tests__/css-interop.spec.ts` refuses one without it.
export type * from './types';
export type * from './Text';
export type * from './Icon';
export type * from './Button';
export type * from './Selection';
export type * from './Status';
export type * from './Containers';
export type * from './Forms';
export type * from './Progress';
export type * from './Overlays';
export type * from './Chrome';

export { Text } from './Text';
export { Icon } from './Icon';
export { Button, IconButton, TextLink } from './Button';
export { CategoryTabs, CheckRow, Chip, Choice, Picker, Segmented, Select, Slot } from './Selection';
export { Badge, Banner, EmptyState, Skeleton, Spinner, Toast } from './Status';
export { Avatar, Card, IconTile, List, ListRow, Section, Stats, Summary } from './Containers';
export { Field, FileRow, Input, InputGroup, Otp, Upload } from './Forms';
export { Steps, Timeline } from './Progress';
export { Dialog, Sheet } from './Overlays';
export {
  ActionBar,
  AppHeader,
  Brand,
  FilterChips,
  NavHeader,
  PageIntro,
  SearchRow,
  TabBar,
} from './Chrome';
