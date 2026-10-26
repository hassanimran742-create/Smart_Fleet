import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform, Vibration } from 'react-native';
import { feedbackFor, type ScanFeedbackKind, type ScanLoopState } from './scanReducer';

/**
 * Plays an outcome's buzz (rulebook §9.2; the patterns are `SCAN_BUZZ` in scanReducer.ts): recorded a
 * short buzz, refused a double one, no answer a stutter, a step complete a long one; nothing for a cylinder
 * already recorded. A phone that can't vibrate just stays silent.
 */
export function playScanFeedback(kind: ScanFeedbackKind): void {
  const pattern = feedbackFor(kind);
  if (pattern === null) return;
  try {
    Vibration.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // No vibration on this phone: the strip still shows the result.
  }
}

/**
 * The feel of each scan result, once per result (the loop's `seq`): its buzz and, on iOS (VoiceOver has
 * no live regions), the strip's new words read aloud. TalkBack reads the strip's live region itself.
 */
export function useScanFeedback(state: Pick<ScanLoopState<unknown>, 'seq' | 'event'>, announce: string): void {
  const seen = useRef(state.seq);
  useEffect(() => {
    if (state.seq === seen.current) return;
    seen.current = state.seq;
    playScanFeedback(state.event);
    if (Platform.OS === 'ios' && announce) AccessibilityInfo.announceForAccessibility(announce);
  }, [state.seq, state.event, announce]);
}

/**
 * The long buzz when a step's count is reached after a scan (`complete` false → true). Never on the first
 * render, and never while the count isn't known (`undefined`), so a step that opens complete stays quiet.
 */
export function useCompleteBuzz(complete: boolean | undefined): void {
  const was = useRef(complete);
  useEffect(() => {
    if (complete === true && was.current === false) playScanFeedback('complete');
    if (complete !== undefined) was.current = complete;
  }, [complete]);
}
