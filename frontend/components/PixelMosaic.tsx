import { useId } from 'react';

export type MosaicTone = 'green' | 'coral' | 'blue';

const palettes: Record<MosaicTone, string[]> = {
  green: ['#ecfaf3', '#d0f1df', '#a2e3c5'],
  coral: ['#fff1ec', '#ffded2', '#ffbaa7'],
  blue: ['#edf3ff', '#d9e5ff', '#aecbff'],
};

const mosaic = [
  '00112200113322',
  '03112230011320',
  '03300233110000',
  '11002200110332',
  '11233020113322',
  '22033001122001',
  '20001133122031',
  '03321130110331',
  '03321100110022',
  '11003220033122',
  '11203221130100',
  '00221103330110',
  '33021100112233',
  '31000221122003',
];

/** Shared decorative background for Team and activity card illustrations. */
export default function PixelMosaic({ tone, wide = false }: { tone: MosaicTone; wide?: boolean }) {
  const patternId = useId();
  const palette = palettes[tone];
  return <svg viewBox={wide ? '0 0 50 17' : '0 0 14 28'} preserveAspectRatio="xMidYMid slice" width={wide ? 350 : 98} height={wide ? 119 : 196} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <defs>
      <pattern id={patternId} width={14} height={14} patternUnits="userSpaceOnUse">
        {mosaic.flatMap((row, y) => [...row].map((pixel, x) =>
          <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[Math.min(Number(pixel), 2)]}/>
        ))}
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill={`url(#${patternId})`}/>
  </svg>;
}
