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
  interpolation: { escapeValue: false },
});

export default i18n;
