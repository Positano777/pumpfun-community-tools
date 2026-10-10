/** Verdict languages offered in the UI. Client-safe: no model access here. */
export const LANGUAGES = {
  hr: { name: 'croatian', label: 'Hrvatski' },
  es: { name: 'spanish', label: 'Español' },
  pt: { name: 'portuguese', label: 'Português' },
  de: { name: 'german', label: 'Deutsch' },
  fr: { name: 'french', label: 'Français' },
  it: { name: 'italian', label: 'Italiano' },
  tr: { name: 'turkish', label: 'Türkçe' },
  ru: { name: 'russian', label: 'Русский' },
  hi: { name: 'hindi', label: 'हिन्दी' },
  id: { name: 'indonesian', label: 'Bahasa Indonesia' },
  vi: { name: 'vietnamese', label: 'Tiếng Việt' },
  ko: { name: 'korean', label: '한국어' },
  zh: { name: 'chinese', label: '中文' },
  ja: { name: 'japanese', label: '日本語' },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

/** English plus every translation: the number the pricing copy quotes. */
export const LANGUAGE_COUNT = Object.keys(LANGUAGES).length + 1;

export function isLanguage(code: unknown): code is LanguageCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}
