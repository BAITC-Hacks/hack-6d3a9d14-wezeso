'use client';
import { useI18n } from '../lib/i18n';
import { Btn } from './UI';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from '@phosphor-icons/react';
import styles from './AuthStory.module.css';

type Coordinate = readonly [number, number];

// Simplified coastlines for the decorative globe, in longitude / latitude.
const LAND: readonly (readonly Coordinate[])[] = [
  [[-168, 71], [-145, 70], [-130, 56], [-123, 49], [-124, 40], [-115, 30], [-105, 22], [-97, 16], [-87, 16], [-82, 9], [-77, 8], [-84, 20], [-90, 22], [-81, 25], [-80, 32], [-66, 45], [-58, 52], [-65, 60], [-82, 63], [-95, 72], [-120, 75], [-145, 73]],
  [[-73, 60], [-48, 60], [-21, 71], [-28, 82], [-48, 84], [-64, 77]],
  [[-81, 12], [-70, 11], [-60, 7], [-50, 1], [-35, -6], [-39, -19], [-49, -29], [-54, -39], [-68, -55], [-75, -49], [-73, -31], [-80, -8]],
  [[-17, 36], [5, 37], [12, 33], [25, 32], [34, 30], [43, 12], [51, 12], [43, -2], [39, -16], [31, -30], [19, -35], [11, -18], [8, 3], [-1, 5], [-16, 14]],
  [[-10, 36], [-9, 44], [0, 49], [7, 54], [5, 59], [19, 71], [30, 70], [30, 60], [45, 68], [70, 73], [100, 77], [135, 71], [178, 65], [165, 55], [145, 50], [140, 37], [129, 34], [122, 22], [109, 18], [104, 5], [98, 10], [97, 22], [88, 22], [79, 7], [72, 21], [58, 25], [50, 13], [43, 13], [35, 30], [27, 40], [23, 37], [16, 40], [12, 45], [3, 43]],
  [[112, -22], [114, -34], [131, -32], [140, -39], [151, -33], [153, -25], [145, -14], [137, -12], [129, -15], [122, -18]],
  [[47, -13], [50, -16], [47, -25], [44, -24]],
  [[-8, 50], [2, 51], [-3, 59], [-7, 58]],
  [[130, 31], [136, 34], [142, 41], [145, 45], [141, 44], [137, 37]],
  [[95, 5], [106, -6], [119, -9], [119, -5], [108, -2], [102, 2]],
  [[166, -34], [178, -38], [172, -46], [166, -45], [173, -39]],
];

const MAP_WIDTH = 1440;
const MAP_HEIGHT = 720;
const SHADES = 8;

function makeLandTexture() {
  const map = document.createElement('canvas');
  map.width = MAP_WIDTH;
  map.height = MAP_HEIGHT;
  const context = map.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#fff';
  for (const polygon of LAND) {
    context.beginPath();
    polygon.forEach(([longitude, latitude], index) => {
      const x = (longitude + 180) / 360 * MAP_WIDTH;
      const y = (90 - latitude) / 180 * MAP_HEIGHT;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fill();
  }
  const pixels = context.getImageData(0, 0, MAP_WIDTH, MAP_HEIGHT).data;
  return Uint8Array.from({ length: MAP_WIDTH * MAP_HEIGHT }, (_, i) => pixels[i * 4 + 3]);
}

type StripeSample = {
  x: number;
  y: number;
  longitude: number;
  row: number;
  shade: number;
  shimmer: boolean;
};

function Globe({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const landTexture = makeLandTexture();
    if (!landTexture) return;
    const land = landTexture;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let size = 0;
    let frame = 0;
    let lastTime = 0;
    let visible = true;
    let stripes: HTMLCanvasElement | null = null;
    let samples: StripeSample[] = [];
    let segmentLength = 0;
    let landWidth = 0;
    const canAnimate = () => !paused && !motion.matches && !document.hidden && visible;

    function draw() {
      if (!context || !land || !size) return;
      const time = elapsedRef.current;
      const rotation = (-0.45 + time * 0.055) / (Math.PI * 2) * MAP_WIDTH;
      context.clearRect(0, 0, size, size);
      if (stripes) context.drawImage(stripes, 0, 0, size, size);
      context.lineCap = 'butt';
      context.strokeStyle = '#b9f4d0';
      context.lineWidth = landWidth;
      const paths = Array.from({ length: SHADES }, () => new Path2D());
      const highlights = Array.from({ length: SHADES }, () => new Path2D());

      // Sample the rotating map through fixed diagonal scanlines. Land thickens
      // those same lines, so no separate dot grid drifts over the hatching.
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const longitude = ((Math.floor(sample.longitude - rotation) % MAP_WIDTH) + MAP_WIDTH) % MAP_WIDTH;
        if (land[sample.row + longitude] < 128) continue;
        const path = paths[sample.shade];
        path.moveTo(sample.x, sample.y);
        path.lineTo(sample.x + segmentLength, sample.y - segmentLength);

        // Small glints stay inside the engraved lines instead of star shapes.
        if (sample.shimmer) {
          const pulse = Math.pow(Math.max(0, Math.sin(time * 1.2 + i * 2.39996)), 10);
          const brightness = Math.floor(pulse * sample.shade);
          if (brightness > 0) {
            highlights[brightness].moveTo(sample.x, sample.y);
            highlights[brightness].lineTo(sample.x + segmentLength, sample.y - segmentLength);
          }
        }
      }
      for (let i = 0; i < SHADES; i++) {
        context.globalAlpha = 0.06 + i / (SHADES - 1) * 0.3;
        context.stroke(paths[i]);
      }
      context.strokeStyle = '#e6ffef';
      for (let i = 1; i < SHADES; i++) {
        context.globalAlpha = i / (SHADES - 1) * 0.55;
        context.stroke(highlights[i]);
      }
      context.globalAlpha = 1;
    }

    function animate(now: number) {
      if (!canAnimate()) return;
      if (now - lastTime >= 1000 / 30) {
        if (lastTime) elapsedRef.current += Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        draw();
      }
      frame = requestAnimationFrame(animate);
    }

    function syncAnimation() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      draw();
      if (canAnimate()) frame = requestAnimationFrame(animate);
    }

    function resize() {
      if (!canvas || !context) return;
      size = canvas.getBoundingClientRect().width;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * ratio);
      canvas.height = Math.round(size * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!size) return;

      // All marks share this screen-space stripe grid, including the ocean,
      // land and shimmer. Only the sampled spherical map rotates underneath.
      stripes = document.createElement('canvas');
      stripes.width = canvas.width;
      stripes.height = canvas.height;
      const hatch = stripes.getContext('2d');
      samples = [];
      if (hatch) {
        const center = size / 2;
        const radius = size * 0.46;
        const scale = size / 780;
        const spacing = 6.5 * scale;
        const step = 3.8 * scale;
        segmentLength = (step - 0.45 * scale) * Math.SQRT1_2;
        landWidth = 2.65 * scale;
        const tilt = -0.18;
        hatch.scale(ratio, ratio);
        const fade = hatch.createLinearGradient(size * 0.05, size * 0.8, size * 0.9, size * 0.2);
        fade.addColorStop(0, 'rgba(185, 244, 208, 0.02)');
        fade.addColorStop(0.45, 'rgba(185, 244, 208, 0.28)');
        fade.addColorStop(1, 'rgba(185, 244, 208, 0.42)');
        hatch.strokeStyle = fade;
        hatch.lineWidth = 0.8 * scale;
        hatch.setLineDash([step - 0.45 * scale, 0.45 * scale]);
        hatch.beginPath();
        for (let offset = -radius + spacing / 2; offset < radius; offset += spacing) {
          const extent = Math.sqrt(radius * radius - offset * offset);
          hatch.moveTo(center + (offset - extent) * Math.SQRT1_2, center + (offset + extent) * Math.SQRT1_2);
          hatch.lineTo(center + (offset + extent) * Math.SQRT1_2, center + (offset - extent) * Math.SQRT1_2);
          for (let along = -extent + step / 2; along < extent - step; along += step) {
            const x = (offset + along) * Math.SQRT1_2 / radius;
            const y = (along - offset) * Math.SQRT1_2 / radius;
            const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
            const sphereX = x * Math.cos(tilt) + y * Math.sin(tilt);
            const sphereY = -x * Math.sin(tilt) + y * Math.cos(tilt);
            const latitude = Math.asin(Math.max(-1, Math.min(1, sphereY)));
            const longitude = Math.atan2(sphereX, z);
            const light = Math.min(1, z * 3) * (0.58 + (x + 1) * 0.21);
            samples.push({
              x: center + x * radius,
              y: center - y * radius,
              longitude: (longitude / (Math.PI * 2) + 0.5) * MAP_WIDTH,
              row: Math.min(MAP_HEIGHT - 1, Math.floor((0.5 - latitude / Math.PI) * MAP_HEIGHT)) * MAP_WIDTH,
              shade: Math.min(SHADES - 1, Math.floor(light * SHADES)),
              shimmer: samples.length % 29 === 0,
            });
          }
        }
        hatch.stroke();
      }
      draw();
    }

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncAnimation();
    });
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    motion.addEventListener('change', syncAnimation);
    document.addEventListener('visibilitychange', syncAnimation);
    resize();
    syncAnimation();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      motion.removeEventListener('change', syncAnimation);
      document.removeEventListener('visibilitychange', syncAnimation);
    };
  }, [paused]);

  return <canvas ref={canvasRef} className={styles.globe} aria-hidden="true" />;
}

export default function AuthStory() {
 const { t, date, number, languageTag } = useI18n();

  const [paused, setPaused] = useState(false);
  return (
    <section className={styles.story}>
      <Globe paused={paused} />
      <img className={styles.logo} src="/halyk.svg" alt="Halyk" width={145} height={51} />
      <div className={styles.body}>
        <h1>{t("Ваш карьерный")}<br />{t("маршрут")}</h1>
      </div>
      <div className={styles.footer}>
        <span>{t("Career Quest · демо")}</span>
        <Btn variant="ghost" shape="square" className={styles.motionToggle} type="button" onClick={() => setPaused(!paused)}
          aria-label={paused ? t("Включить анимацию") : t("Приостановить анимацию")}
          title={paused ? t("Включить анимацию") : t("Приостановить анимацию")}>
          {paused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}
        </Btn>
      </div>
    </section>
  );
}
