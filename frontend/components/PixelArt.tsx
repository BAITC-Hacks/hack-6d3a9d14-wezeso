export type PixelTone = 'green' | 'coral' | 'blue';
export type PixelKind = 'hourglass' | 'trophy' | 'skills' | 'book' | 'conversation' | 'people' | 'microphone' | 'shield' | 'certificate' | 'check';

const glyphs: Record<PixelKind, string[]> = {
  hourglass: [
    '.11111111111.', '.12222222221.', '..122222221..', '...1222221...',
    '....12221....', '.....121.....', '......1......', '.....131.....',
    '....13331....', '...1333331...', '..133333331..', '.11111111111.',
  ],
  trophy: [
    '...1111111...', '.11122222111.', '1131222221311', '1.312222213.1',
    '1.312222213.1', '.11122222111.', '...1122211...', '....11111....',
    '.....121.....', '.....121.....', '...1111111...', '...1333331...', '...1111111...',
  ],
  skills: [
    '.....111.....', '.....131.....', '.....111.....', '......2......',
    '..222222222..', '..2...2...2..', '.111.111.111.', '.131.131.131.',
    '.111.111.111.', '......2......', '......2......', '.....111.....', '.....111.....',
  ],
  book: [
    '.11111.11111.', '1333331333331', '1322231322231', '1333331333331',
    '1322231322231', '1333331333331', '1322231322231', '1333331333331',
    '1333331333331', '.11111111111.', '......1......',
  ],
  conversation: [
    '..111111111..', '.13333333331.', '1333333333331', '1333333333331',
    '1322322322331', '1322322322331', '1333333333331', '.13333333331.',
    '..111111111..', '...1231......', '...121.......', '...11........',
  ],
  people: [
    '.....111.....', '.11.12221.11.', '1221122211221', '1221.111.1221',
    '.11...2...11.', '....11111....', '.11122222111.', '1221222221221',
    '1221222221221', '1221222221221', '.11111111111.',
  ],
  microphone: [
    '....11111....', '...1222221...', '...1212121...', '...1222221...',
    '...1212121...', '.1.1222221.1.', '.1..11111..1.', '.12.......21.',
    '..122222221..', '...1111111...', '......1......', '......1......', '...1111111...',
  ],
  shield: [
    '......1......', '...1112111...', '.11222222211.', '.13333333331.',
    '.13333313331.', '.13333113331.', '.13131133331.', '..131133331..',
    '..133333331..', '...1333331...', '....13331....', '.....131.....', '......1......',
  ],
  certificate: [
    '1111111111111', '1333333333331', '1322222222231', '1333333333331',
    '1322223333331', '1333333311131', '1333333122211', '1111111122211',
    '........111..', '.......12121.', '.......12.21.', '.......1...1.',
  ],
  check: [
    '....11111....', '..112222211..', '.12233333221.', '.12333333231.',
    '1233333313331', '1231333113331', '1231131133331', '1233111333331',
    '.12331333231.', '.12233333221.', '..112222211..', '....11111....',
  ],
};

const colors: Record<PixelTone, Record<string, string>> = {
  green: { '1': '#096d55', '2': '#21b58a', '3': '#b8edce' },
  coral: { '1': '#a32e35', '2': '#ed7172', '3': '#ffd9c7' },
  blue: { '1': '#214d9e', '2': '#6b9fea', '3': '#c7e1ff' },
};

const activityTones: Record<string, PixelTone> = { course: 'blue', workshop: 'green', mentoring: 'coral', meetup: 'coral', certification: 'blue', compliance: 'green', onboarding: 'green' };

export function activityTone(type: string): PixelTone {
  return activityTones[type] || 'green';
}

export function activitySymbol(type: string, title: string): PixelKind {
  if (/speaking|presentation/i.test(title)) return 'microphone';
  if (/security|secure|compliance/i.test(title)) return 'shield';
  if (/architecture|system|design/i.test(title)) return 'skills';
  return ({ workshop: 'skills', mentoring: 'conversation', meetup: 'people', certification: 'certificate', compliance: 'shield', onboarding: 'people' } as Record<string, PixelKind>)[type] || 'book';
}

/** A recognisable, static pixel illustration on a transparent canvas. */
export default function PixelArt({ kind, tone = 'green', className = '' }: { kind: PixelKind; tone?: PixelTone; className?: string }) {
  const rows = glyphs[kind];
  return <svg className={`pixel-art ${className}`} data-pixel-icon={kind} viewBox="0 0 25 17" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <g transform={`translate(6 ${(17 - rows.length) / 2})`}>{rows.flatMap((row, y) => Array.from(row).map((tile, x) => tile === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colors[tone][tile]}/>))}</g>
  </svg>;
}
