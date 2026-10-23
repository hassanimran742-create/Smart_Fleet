/**
 * When a form's "Leave without saving?" asks (UX_MOBILE §2.2 screen rules). It has no imports, so the
 * rule is tested on its own with the real stack router (apps/api/test/unit/ui/mobile-logic.spec.ts).
 */

/** Navigation actions that mean the person is leaving by hand (Back, the header arrow, a swipe). */
export const LEAVING_ACTIONS: ReadonlySet<string> = new Set(['GO_BACK', 'POP', 'POP_TO_TOP']);

/**
 * True when an action that removes a form's screen should ask first. A screen that saved and moves on
 * (replace, reset, navigate) is never stopped, and neither is one that navigates to Home on purpose.
 */
export function isLeavingByHand(action: { type: string }): boolean {
  return LEAVING_ACTIONS.has(action.type);
}
