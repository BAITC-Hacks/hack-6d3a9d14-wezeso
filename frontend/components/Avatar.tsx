'use client';
// React adapter for jeremy-prt/bloub's MIT-licensed framework-free engine.
import { useEffect, useId, useRef, useState } from 'react';
import { BotEngine } from '../vendor/bloub/engine';
import type { StateId } from '../vendor/bloub/states';
export default function Avatar({ state = 'idle', size = 160 }: { state?: StateId; size?: number }) {
  const engine = useRef(new BotEngine(100, state));
  const clock = useRef(0);
  const [frame, setFrame] = useState(() => engine.current.sample(0));
  const id = useId().replaceAll(':', '');
  useEffect(() => { engine.current.setState(state, clock.current); }, [state]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0; let previous = performance.now(); let lastPaint = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .06); previous = now;
      if (!document.hidden) { clock.current += dt; if (now - lastPaint > 32) { setFrame(engine.current.sample(clock.current)); lastPaint = now; } }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(raf); if (media.matches) { setFrame(engine.current.sample(clock.current + 2)); } else { previous = performance.now(); raf = requestAnimationFrame(tick); } };
    start(); media.addEventListener('change', start);
    return () => { cancelAnimationFrame(raf); media.removeEventListener('change', start); };
  }, [state]);
  return <svg className="bloub" data-state={state} width={size} height={size} viewBox="-158 -158 316 316" role="img" aria-label={`Помощник: ${state === 'thinking' ? 'обрабатывает запрос' : state === 'sleep' ? 'ИИ отключён' : state === 'alert' ? 'ошибка' : 'готов помочь'}`}>
    <defs><mask id={`mask-${id}`} maskUnits="userSpaceOnUse" x="-158" y="-158" width="316" height="316"><path d={frame.bodyPath} fill="white" />{frame.eyes.map((eye, i) => <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="black" />)}</mask></defs>
    <g opacity={frame.bodyAlpha}><path d={frame.bodyPath} fill="#e7f8f3" /><g mask={`url(#mask-${id})`}><rect x="-158" y="-158" width="316" height="316" fill="#00805f" /></g></g>
    {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill="#805600" />}
  </svg>;
}
