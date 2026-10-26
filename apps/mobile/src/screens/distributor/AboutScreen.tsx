import { HelpContent } from './HelpScreen';

/**
 * The "About" route of the retired customer stack (ClientStack, kept out of navigation). The shop app
 * uses Help (S12) instead; this shows the office's buttons, hours and the app version, with no
 * made-up support number and no shop money texts.
 */
export function AboutScreen() {
  return <HelpContent shop={false} />;
}
