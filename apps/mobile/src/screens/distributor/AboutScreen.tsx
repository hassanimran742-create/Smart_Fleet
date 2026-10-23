import { HelpContent } from './HelpScreen';

/**
 * The "About" route that the driver app's stack and the retired customer stack still mount. The shop
 * app uses Help (S12) instead; this keeps the office's numbers, the app version and Sign out, with no
 * made-up support number and no shop money texts.
 */
export function AboutScreen() {
  return <HelpContent shop={false} />;
}
