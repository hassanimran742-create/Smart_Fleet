import * as SecureStore from 'expo-secure-store';
import i18n from './index';

const KEY = 'app.language';

export async function loadSavedLanguage() {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored === 'en' || stored === 'ur') {
      await i18n.changeLanguage(stored);
    }
  } catch {}
}

export async function setLanguage(lang: 'en' | 'ur') {
  await SecureStore.setItemAsync(KEY, lang);
  await i18n.changeLanguage(lang);
}

export function currentLanguage(): 'en' | 'ur' {
  return (i18n.language as 'en' | 'ur') ?? 'en';
}
