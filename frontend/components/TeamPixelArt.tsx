import PixelMosaic, { type MosaicTone } from './PixelMosaic';

type PixelArtKind = 'people' | 'conversation' | 'decisions';

// Each character is one square tile. The silhouettes share the same 14 × 14 grid.
const artwork: Record<PixelArtKind, { palette: string[]; pixels: string[] }> = {
  people: {
    palette: ['#ecfaf3', '#d0f1df', '#a2e3c5', '#57c59a', '#078064', '#064d40'],
    pixels: [
      '00110001220010',
      '01200000110021',
      '11000055000010',
      '00000555500100',
      '00550555505500',
      '05555055055550',
      '05555000055550',
      '00550555505500',
      '00005555550000',
      '05545555554550',
      '05545555554550',
      '05545555554550',
      '21000000000120',
      '10211002110001',
    ],
  },
  conversation: {
    palette: ['#fff1ec', '#ffded2', '#ffbaa7', '#f98770', '#d2523e', '#84382f'],
    pixels: [
      '01100210001120',
      '12000000110001',
      '20055555555010',
      '00544444444500',
      '00544444444500',
      '00541111144500',
      '00544444444500',
      '00541111444500',
      '00544444444500',
      '00055545555000',
      '01000545000120',
      '00000550001210',
      '12100000000001',
      '01210001100210',
    ],
  },
  decisions: {
    palette: ['#edf3ff', '#d9e5ff', '#aecbff', '#72a0f4', '#3468cc', '#203d78'],
    pixels: [
      '01210000110021',
      '10000020000210',
      '20000000050001',
      '01000000550000',
      '00005005500010',
      '00005555000120',
      '00000550000000',
      '00550000005500',
      '00545000054500',
      '00544555544500',
      '00544444444500',
      '00055555555000',
      '21000000000121',
      '02110012100010',
    ],
  },
};

const tones: Record<PixelArtKind, MosaicTone> = { people: 'green', conversation: 'coral', decisions: 'blue' };

export default function TeamPixelArt({ kind, className }: { kind: PixelArtKind; className?: string }) {
  const { palette, pixels } = artwork[kind];
  return <span className={className} aria-hidden="true">
    <PixelMosaic tone={tones[kind]}/>
    <svg viewBox="0 0 14 14" width={98} height={98} shapeRendering="crispEdges" focusable="false">
    {pixels.flatMap((row, y) => [...row].map((pixel, x) => {
      // Keep the glyph and its light cutouts; let the mosaic run behind it.
      const glyph = Number(pixel) >= 4 || (kind === 'conversation' && pixel === '1' && x >= 4 && x <= 8 && (y === 5 || y === 7));
      return glyph ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[Number(pixel)]} /> : null;
    }))}
    </svg>
  </span>;
}
