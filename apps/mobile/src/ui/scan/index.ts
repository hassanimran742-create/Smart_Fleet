/**
 * The cylinder scanner (UX_MOBILE §2.2 #24), owned by the mobile-driver lane: the camera of the driver's
 * step screens in Inc 1 (driver spec §1.2–§1.3), the full version with progress, typed numbers and
 * return states in Inc 2 (§7.1). SizeLines is shared with the shop's Receive scan (Inc 2).
 */
export {
  cameraHeightFor,
  ScanPanel,
  type ScanOutcome,
  type ScanPanelProps,
  type ScanRead,
  type ScanStep,
} from './ScanPanel';
export { SizeLines, type SizeLine, type SizeLinesProps } from './SizeLines';
