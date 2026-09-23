import type { History, Request, User } from './types';

const shapes = ['cercle', 'galet', 'squircle', 'capsule', 'triangle', 'hexagone', 'nuage', 'goutte'] as const;
const expressions = ['attentif', 'heureux', 'timide', 'curieux'] as const;
const patterns = ['freckles', 'spark', 'stripes', 'constellation'] as const;
const palettes = [
  { id: 'ocean', hue: 218, highlight: '#68e6f4', accent: '#b7f9ff' },
  { id: 'sunset', hue: 12, highlight: '#ffcd70', accent: '#fff0ad' },
  { id: 'nebula', hue: 267, highlight: '#ed9dff', accent: '#ffd18b' },
  { id: 'berry', hue: 330, highlight: '#bba4ff', accent: '#ffdaed' },
  { id: 'solar', hue: 30, highlight: '#ffe386', accent: '#ffeed0' },
  { id: 'lagoon', hue: 184, highlight: '#7aaaff', accent: '#b8ffff' },
  { id: 'citrus', hue: 86, highlight: '#ffe886', accent: '#fff3b1' },
  { id: 'iris', hue: 244, highlight: '#ffabd9', accent: '#d2edff' },
] as const;
const names = ['Искра', 'Росток', 'Комета', 'Луч', 'Пульс', 'Орбита', 'Клевер', 'Маяк'];

/** Independent, mixed seeds keep nearby employee IDs from sharing every trait. */
function traitSeed(identity: string, trait: string) {
  let seed = 2166136261;
  for (const char of `${identity}:${trait}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  seed ^= seed >>> 16;
  seed = Math.imul(seed, 0x85ebca6b);
  seed ^= seed >>> 13;
  seed = Math.imul(seed, 0xc2b2ae35);
  return (seed ^ seed >>> 16) >>> 0;
}

/** Stable identity, shared by the owner, roster and profile on every device. */
export function characterIdentity(user: Pick<User, 'employee_id' | 'id'>): string {
  return user.employee_id || `account:${user.id}`;
}

export function characterAppearance(identity: string) {
  let seed = 2166136261;
  for (const char of identity) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const palette = palettes[traitSeed(identity, 'palette') % palettes.length];
  const tone = traitSeed(identity, 'tone');
  const hue = palette.hue + tone % 17 - 8;
  const saturation = 62 + (tone >>> 8) % 16;
  const lightness = 35 + (tone >>> 16) % 9;
  return {
    name: names[(seed >>> 8) % names.length],
    palette: palette.id,
    shape: shapes[traitSeed(identity, 'shape') % shapes.length],
    expression: expressions[traitSeed(identity, 'face') % expressions.length],
    pattern: patterns[traitSeed(identity, 'pattern') % patterns.length],
    color: `hsl(${hue} ${saturation}% ${lightness}%)`,
    highlight: palette.highlight,
    accent: palette.accent,
    tint: `hsl(${hue} 52% 95%)`,
    eye: `hsl(${hue} 65% 96%)`,
    marks: 1 + (seed >>> 24) % 3,
    markRotation: traitSeed(identity, 'mark-rotation') % 31 - 15,
  };
}

export function characterProgress(employeeId: string, history: History[] = [], requests: Request[] = []) {
  // History belongs to the selected profile. Requests can include the entire team.
  const completed = employeeId ? new Set([
    ...history.filter(item => item.status === 'completed').map(item => `history:${item.record_id}`),
    ...requests.filter(item => item.employee_id === employeeId && item.status === 'completed').map(item => `request:${item.id}`),
  ]).size : 0;
  const xp = completed * 100;
  return { completed, xp, level: 1 + Math.floor(xp / 500), levelXP: xp % 500, nextLevelXP: 500 };
}
