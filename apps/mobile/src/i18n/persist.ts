import * as SecureStore from 'expo-secure-store';
import i18n, { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type AppLanguage } from './index';

/**
 * The saved language choice. The pilot is English only and the language switch is hidden
 * (UX_MOBILE §3.3), so only languages with resources are applied: an older install that saved "ur"
 * keeps English. Kept so Urdu can return as a setting without new plumbing.
 */
const KEY = 'app.language';

function isSupported(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export async function loadSavedLanguage(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (isSupported(stored) && stored !== i18n.language) {
      await i18n.changeLanguage(stored);
    }
  } catch {
    // Secure storage unavailable: keep the default language.
  }
}

export async function setLanguage(lang: AppLanguage): Promise<void> {
  if (!isSupported(lang)) return;
  try {
    await SecureStore.setItemAsync(KEY, lang);
  } catch {
    // Not saved; the choice still applies until the app restarts.
  }
  await i18n.changeLanguage(lang);
}

export function currentLanguage(): AppLanguage {
  return isSupported(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}
