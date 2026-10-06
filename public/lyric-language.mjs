export const LYRIC_LANGUAGES = ['zh','en','ja','ko','yue','fr','de','it','pt','ru','es'];
const supported = language => LYRIC_LANGUAGES.includes(language);

// A recognised token knows its language even when the dropdown remains automatic.
export function alignmentLanguage(selected = 'auto', token = null) {
  return supported(selected) ? selected : supported(token?.language) ? token.language : 'auto';
}

export function textLanguage(text, selected = 'auto', tokens = []) {
  if (supported(selected)) return selected;
  const value = String(text);
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 'ja';
  if (/\p{Script=Hangul}/u.test(value)) return 'ko';
  const languages = [...new Set(tokens.map(t => t.language).filter(supported))];
  if (/\p{Script=Han}/u.test(value)) return languages.length === 1 && ['ja','yue'].includes(languages[0]) ? languages[0] : 'zh';
  if (/\p{Script=Latin}/u.test(value)) return languages.length === 1 && ['en','fr','de','it','pt','es'].includes(languages[0]) ? languages[0] : 'en';
  return languages.length === 1 ? languages[0] : 'auto';
}
