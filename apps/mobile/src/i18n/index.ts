import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      welcome: 'Welcome',
      phone: 'Phone',
      sendOtp: 'Send OTP',
      verify: 'Verify',
      otp: 'OTP code',
      orders: 'Orders',
      newOrder: 'New order',
      trips: 'Trips',
      scan: 'Scan',
      logout: 'Sign out',
    },
  },
  ur: {
    translation: {
      welcome: 'خوش آمدید',
      phone: 'فون',
      sendOtp: 'OTP بھیجیں',
      verify: 'تصدیق',
      otp: 'OTP کوڈ',
      orders: 'آرڈرز',
      newOrder: 'نیا آرڈر',
      trips: 'سفر',
      scan: 'اسکین',
      logout: 'سائن آؤٹ',
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  // Hermes (React Native's JS engine) doesn't include the full Intl.PluralRules
  // API. Acknowledge the legacy v3 plural-format fallback so i18next stops
  // warning at runtime. Switch to "v4" + an intl-pluralrules polyfill if you
  // ever need full CLDR plural categories (rare for en/ur).
  compatibilityJSON: 'v3',
  interpolation: { escapeValue: false },
});

export default i18n;
