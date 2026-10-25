/**
 * The mobile design system (UX_MOBILE §2; UX_PRINCIPLES §3). Screens import from here, use only these
 * tokens and components, and never native alert pop-ups or colour literals. `ui/scan/` (ScanPanel) is
 * owned by the driver lane and imported from its own folder.
 */
export * from './tokens';
export { ltr } from './bidi';
export { keepTogether } from './keepTogether';
export { useReduceMotion } from './useReduceMotion';

export { Text, type TextProps } from './Text';
export { Icon, preloadIconFont, type IconName, type IconProps, type IconSize } from './Icon';
export { Screen, type ScreenProps } from './Screen';
export {
  HeaderCallOfficeButton,
  HeaderIconButton,
  makeScreenOptions,
  type HeaderIconButtonProps,
} from './Header';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card, type CardProps, type CardTone } from './Card';
export { MoneyText, moneyA11yLabel, type MoneySign, type MoneyTextProps } from './MoneyText';
export { StatusChip, type ChipTone, type StatusChipProps } from './StatusChip';
export {
  isKnownStatus,
  resolveStatus,
  type AnswerChipState,
  type DayEndChipStatus,
  type DriverStepState,
  type RefillChipStage,
  type ResolvedStatus,
  type StatusKind,
  type StatusLook,
  type StatusParams,
  type StatusValues,
} from './statusTables';
export {
  Field,
  PhoneField,
  phoneFieldText,
  RupeeField,
  type FieldAction,
  type FieldProps,
  type PhoneFieldProps,
  type RupeeFieldProps,
} from './Field';
export { AmountChips, OTHER_AMOUNT, type AmountChipsProps } from './AmountChips';
export { ChoiceChips, type ChoiceChipOption, type ChoiceChipsProps } from './ChoiceChips';
export { SegmentedControl, type SegmentedControlProps, type SegmentOption } from './SegmentedControl';
export { Stepper, type StepperProps } from './Stepper';
export { ListRow, type ListRowProps } from './ListRow';
export { AddMore, type AddMoreProps } from './AddMore';
export { Fab, FAB_CLEARANCE, type FabProps } from './Fab';
export { CountBar, type CountBarMode, type CountBarProps } from './CountBar';
export { EmptyState, type EmptyStateAction, type EmptyStateProps } from './EmptyState';
export {
  ErrorBanner,
  FirstLoadState,
  OfflineEmpty,
  useErrorExtraAction,
  type ErrorBannerAction,
  type ErrorBannerProps,
  type FirstLoadStateProps,
  type OfflineEmptyProps,
} from './ErrorBanner';
export { ActionLine, type ActionLineProps } from './ActionLine';
export { QueryBoundary, type BoundaryQuery, type QueryBoundaryProps } from './QueryBoundary';
export { Skeleton, SkeletonCard, SkeletonLines, SkeletonList, type SkeletonProps } from './Skeleton';
export { ToastHost, useToast, type ToastInput, type ToastTone } from './Toast';
export {
  confirm,
  ConfirmHost,
  ConfirmSheet,
  SheetFrame,
  useConfirm,
  type ConfirmInput,
  type ConfirmReason,
  type ConfirmRequest,
  type ConfirmResult,
  type ConfirmSheetProps,
  type SheetFrameProps,
} from './ConfirmSheet';
export { PickerSheet, type PickerItem, type PickerSection, type PickerSheetProps } from './PickerSheet';
export { StepHeader, type StepHeaderProps } from './StepHeader';
export { Timeline, type TimelineItem, type TimelineProps, type TimelineState } from './Timeline';
export { EnvBanner } from './EnvBanner';
export { OfflineBanner } from './OfflineBanner';
export { useLeaveGuard } from './useLeaveGuard';
export { useNoConnection } from '../store/appStatus';
export { isNetworkError } from '../api/errors';
