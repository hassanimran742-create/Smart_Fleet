/**
 * Moved to `ui/ChoiceChips.tsx` (UX_PRINCIPLES §3: ChoiceChips). This re-export keeps the shop
 * screens' imports working until they switch to `ChoiceChips` from `../../../ui`; then delete this file.
 */
export {
  ChoiceChips as FilterChips,
  type ChoiceChipOption as FilterChipOption,
  type ChoiceChipsProps as FilterChipsProps,
} from '../../../ui/ChoiceChips';
