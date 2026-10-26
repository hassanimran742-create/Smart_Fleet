/**
 * The cylinder scanner (UX_MOBILE §2.2 #24, §7.1), owned by the driver lane: the camera of the driver's
 * step screens and the refill run, and the shop's Receive scan (Inc 2). The read loop is plain logic in
 * scanReducer.ts (TEST_CASES DRV-035); the buzz is useScanFeedback.ts. SizeLines is shared too.
 */
export {
  answerFromResult,
  cameraHeightFor,
  ScanPanel,
  type ScanAnswer,
  type ScanOutcome,
  type ScanPanelProps,
  type ScanRead,
  type ScanReply,
  type ScanStep,
} from './ScanPanel';
export {
  createScanLoop,
  feedbackFor,
  scanReducer,
  SCAN_BUZZ,
  type PendingScan,
  type ScanEntryMethod,
  type ScanLoop,
  type ScanLoopState,
  type ScanReturnState,
} from './scanReducer';
export { playScanFeedback, useCompleteBuzz, useScanFeedback } from './useScanFeedback';
export { SizeLines, type SizeLine, type SizeLinesProps } from './SizeLines';
