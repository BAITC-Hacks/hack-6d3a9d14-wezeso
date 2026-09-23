import kk from './locales/kk.json';
import catalog from './locales/catalog.json';
import serverKk from './locales/server-kk.json';
import coursesKk from './locales/courses-kk.json';

export type Locale = 'ru' | 'kk';
export const localeTag: Record<Locale, string> = { ru: 'ru-KZ', kk: 'kk-KZ' };
export const localeCookie = 'career-quest-language';
export const isLocale = (value: unknown): value is Locale => value === 'ru' || value === 'kk';

export function detectLocale(saved?: string | null, accepted = ''): Locale {
  if (isLocale(saved)) return saved;
  const languages = accepted.split(',').map((item, index) => {
    const [tag, ...parameters] = item.trim().toLowerCase().split(';');
    const quality = parameters.find(part => part.trim().startsWith('q='));
    return { language: tag.split('-')[0], quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(item => item.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index);
  return languages.find(item => isLocale(item.language))?.language as Locale || 'ru';
}

type Parameters = Record<string, string | number | undefined>;
const dictionaries: Record<Locale, Record<string, string>> = { ru: catalog.ru, kk: { ...kk, ...catalog.kk, ...serverKk, ...coursesKk } };
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const serverTemplates = Object.entries(serverKk).filter(([source]) => /%[sdw]|%\.0f/.test(source)).map(([source, target]) => {
  const verbs: string[] = [];
  const parts = source.split(/(%%|%\.0f|%[sdw])/);
  const expression = parts.map(part => {
    if (part === '%%') return '%';
    if (/^%(?:\.0f|[sdw])$/.test(part)) { verbs.push(part); return part === '%d' || part === '%.0f' ? '([+-]?\\d+(?:[.,]\\d+)?)' : '(.+?)'; }
    return escapePattern(part);
  }).join('');
  return { source, target, verbs, pattern: new RegExp(`^${expression}$`, 's') };
});

function localizeCopy(locale: Locale, source: string, depth = 0): string {
  const exact = dictionaries[locale][source];
  if (exact !== undefined) return exact;
  if (depth > 4) return source;
  for (const template of serverTemplates) {
    const match = template.pattern.exec(source);
    if (!match) continue;
    let index = 0;
    return (locale === 'kk' ? template.target : template.source).replace(/%%|%\.0f|%[sdw]/g, verb => {
      if (verb === '%%') return '%';
      const value = match[++index];
      return verb === '%d' || verb === '%.0f' ? formatNumber(locale, Number(value.replace(',', '.'))) : localizeCopy(locale, value, depth + 1);
    });
  }
  // Server explanations are composed from these exact, stable fragments.
  for (const separator of ['\n\n', '. ']) {
    if (!source.includes(separator)) continue;
    const parts = source.split(separator);
    const translated = parts.map((part, index) => {
      const period = separator === '. ' && index < parts.length - 1;
      const full = period ? localizeCopy(locale, part + '.', depth + 1) : part;
      return period && full !== part + '.' ? full.replace(/\.$/, '') : localizeCopy(locale, part, depth + 1);
    }).join(separator);
    if (translated !== source) return translated;
  }
  if (locale === 'kk') {
    for (const [prefix, target] of Object.entries(serverKk)) {
      if (prefix.length > 12 && prefix.endsWith(' ') && source.startsWith(prefix)) return target + source.slice(prefix.length);
    }
  }
  return source;
}

/** Only application copy is translated. Identifiers and user-authored text stay intact. */
export function translate(locale: Locale, source: string | null | undefined, parameters: Parameters = {}): string {
  if (!source) return '';
  const message = localizeCopy(locale, source);
  return message.replace(/\{(\w+)\}/g, (token, name) => {
    const value = parameters[name];
    return value === undefined ? token : typeof value === 'number' ? formatNumber(locale, value) : localizeCopy(locale, value);
  });
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(localeTag[locale], options).format(value);
}

export function formatDate(locale: Locale, value: string | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return translate(locale, 'В любое время');
  // Calendar dates represent a day, not a UTC instant. Never shift a session date by the user's zone.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime()) || (dateOnly && parsed.toISOString().slice(0, 10) !== value)) return translate(locale, 'Дата не указана');
  return new Intl.DateTimeFormat(localeTag[locale], {
    ...(options ?? { day: 'numeric', month: 'short', year: 'numeric' }),
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  }).format(parsed);
}

const nouns = {
  activity: ['активность', 'активности', 'активностей', 'іс-шара'],
  employee: ['сотрудник', 'сотрудника', 'сотрудников', 'қызметкер'],
  skill: ['навык', 'навыка', 'навыков', 'дағды'],
  request: ['заявка', 'заявки', 'заявок', 'өтінім'],
  step: ['шаг', 'шага', 'шагов', 'қадам'],
  lesson: ['урок', 'урока', 'уроков', 'сабақ'],
  point: ['балл', 'балла', 'баллов', 'балл'],
  character: ['символ', 'символа', 'символов', 'таңба'],
  byte: ['байт', 'байта', 'байт', 'байт'],
  profile: ['профиль', 'профиля', 'профилей', 'профиль'],
  event: ['событие', 'события', 'событий', 'іс-шара'],
  record: ['запись истории', 'записи истории', 'записей истории', 'тарих жазбасы'],
  week: ['неделя', 'недели', 'недель', 'апта'],
  day: ['день', 'дня', 'дней', 'күн'],
} as const;
export type CountNoun = keyof typeof nouns;
export function formatCount(locale: Locale, noun: CountNoun, value: number) {
  const forms = nouns[noun];
  const plural = new Intl.PluralRules(localeTag[locale]).select(value);
  const word = locale === 'kk' ? forms[3] : forms[plural === 'one' ? 0 : plural === 'many' ? 2 : 1];
  return `${formatNumber(locale, value)} ${word}`;
}
