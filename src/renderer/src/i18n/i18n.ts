import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'

// English is the only language — the in-app language switcher was removed.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en }
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n
