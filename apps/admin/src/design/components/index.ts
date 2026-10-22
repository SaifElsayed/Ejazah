// T036: the admin panel's design components (docs/design/components.md, ADR 0014 D1): the phone's
// primitives on shadcn/ui's behaviour base at the compact density, themed by `tokens.css` and drawn
// with the design's own classes (`components.css`, generated from the design under
// `check:generated`), and the console pieces only a desktop needs. Pages compose these; they do not
// draw buttons or colours of their own.
import '../tokens.css';
import '../components.css';

export type * from './types';
export { Icon, type IconProps } from './Icon';
export {
  Button,
  type ButtonProps,
  IconButton,
  type IconButtonProps,
  TextLink,
  type TextLinkProps,
} from './Button';
export {
  CategoryTabs,
  type CategoryTabsProps,
  CheckRow,
  type CheckRowProps,
  Choice,
  ChoiceGroup,
  type ChoiceGroupProps,
  type ChoiceProps,
  Chip,
  type ChipProps,
  FilterChips,
  type FilterChipsProps,
  Segmented,
  type SegmentedProps,
} from './Selection';
export {
  Badge,
  type BadgeProps,
  Banner,
  type BannerProps,
  EmptyState,
  type EmptyStateProps,
  Skeleton,
  type SkeletonProps,
  Toast,
  type ToastProps,
} from './Status';
export {
  Avatar,
  type AvatarProps,
  Card,
  type CardProps,
  IconTile,
  type IconTileProps,
  List,
  ListRow,
  type ListProps,
  type ListRowProps,
  Summary,
  type SummaryProps,
} from './Containers';
export {
  Field,
  type FieldProps,
  Input,
  InputGroup,
  type InputGroupProps,
  type InputProps,
  Otp,
  type OtpProps,
  Upload,
  type UploadProps,
} from './Forms';
export {
  Meter,
  type MeterProps,
  Steps,
  type StepsProps,
  Timeline,
  type TimelineProps,
} from './Progress';
export { Dialog, type DialogProps } from './Dialog';
export {
  AuthCard,
  type AuthCardProps,
  Brand,
  Console,
  type ConsoleProps,
  DocThumb,
  type DocThumbProps,
  KeyValue,
  type KeyValueProps,
  LanguageSwitch,
  NavItem,
  type NavItemProps,
  Page,
  PageHeader,
  type PageHeaderProps,
  type PageProps,
  Pager,
  type PagerProps,
  Panel,
  type PanelProps,
  QueueCard,
  type QueueCardProps,
  SearchRow,
  type SearchRowProps,
  Sidebar,
  type SidebarProps,
  Split,
  type SplitProps,
  Toolbar,
  type ToolbarProps,
} from './Console';
export { DataTable, type DataTableColumn, type DataTableProps } from './DataTable';
