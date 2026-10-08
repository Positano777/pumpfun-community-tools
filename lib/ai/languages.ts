/** Verdict languages offered in the UI. Client-safe: no model access here. */
export const LANGUAGES = {
  hr: { name: 'croatian', label: 'Hrvatski' },
  es: { name: 'spanish', label: 'Español' },
  pt: { name: 'portuguese', label: 'Português' },
  de: { name: 'german', label: 'Deutsch' },
  fr: { name: 'french', label: 'Français' },
  tr: { name: 'turkish', label: 'Türkçe' },
  zh: { name: 'chinese', label: '中文' },
  ja: { name: 'japanese', label: '日本語' },
} as const;

export type LanguageCode = keyof typeof LANGUAGES;

export function isLanguage(code: unknown): code is LanguageCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}
