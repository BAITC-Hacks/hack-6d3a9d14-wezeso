'use client';
// React adapter for jeremy-prt/bloub's MIT-licensed framework-free engine.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BotEngine } from '../vendor/bloub/engine';
import { SHAPE_BY_ID } from '../vendor/bloub/skins';
import { EXPRESSION_BY_ID } from '../vendor/bloub/expressions';
import type { StateId } from '../vendor/bloub/states';
import { characterAppearance } from '../lib/character';

type Props = { state?: StateId; size?: number; identity?: string; label?: string; animated?: boolean };

export default function Avatar({ state = 'idle', size = 160, identity, label, animated = true }: Props) {
  const appearance = useMemo(() => characterAppearance(identity || 'career-quest:visitor'), [identity]);
  const shape = SHAPE_BY_ID.get(appearance.shape)!.radii;
  const expression = EXPRESSION_BY_ID.get(appearance.expression)!;
  const [engine] = useState(() => new BotEngine(100, state, shape, expression));
  const clock = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const [frame, setFrame] = useState(() => engine.sample(0));
  const id = useId().replaceAll(':', '');

  useEffect(() => {
    engine.setShape(shape, clock.current);
    engine.setExpression(expression, clock.current);
    engine.setState(state, clock.current);
  }, [engine, shape, expression, state]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let previous = performance.now();
    let lastPaint = 0;
    let visible = true;
    let pointer: { x: number; y: number } | null = null;
    let lastTarget = '';

    const resetLook = () => {
      pointer = null;
      lastTarget = '';
      engine.setLook(null, clock.current);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') { resetLook(); return; }
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onLeave = (event: PointerEvent) => { if (!event.relatedTarget) resetLook(); };
    const updateLook = () => {
      if (!pointer || !svg.current) return;
      // Re-read layout so a stationary pointer remains correct after scrolling/resizing.
      const box = svg.current.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const reach = Math.max(box.width * 1.5, 180);
      const yaw = Math.tanh((pointer.x - box.left - box.width / 2) / reach) * 32;
      const pitch = -Math.tanh((pointer.y - box.top - box.height / 2) / reach) * 24;
      const target = `${yaw.toFixed(2)},${pitch.toFixed(2)}`;
      if (target === lastTarget) return;
      engine.setLook({ yaw, pitch, mix: 1, spin: 0, wander: 0 }, clock.current);
      lastTarget = target;
    };
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000, .06);
      previous = now;
      if (visible && !document.hidden) {
        clock.current += dt;
        if (now - lastPaint >= 32) {
          updateLook();
          setFrame(engine.sample(clock.current));
          lastPaint = now;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      resetLook();
      // Settle state/shape transitions, then keep a still frame for reduced motion.
      if (media.matches || !animated) {
        clock.current += 2;
        setFrame(engine.sample(clock.current));
      } else {
        previous = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const onVisibility = () => { if (document.hidden) resetLook(); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    if (svg.current) observer.observe(svg.current);
    if (animated) {
      window.addEventListener('pointermove', onPointer, { passive: true });
      window.addEventListener('pointerout', onLeave);
      window.addEventListener('pointercancel', resetLook);
      window.addEventListener('blur', resetLook);
      document.addEventListener('visibilitychange', onVisibility);
    }
    start();
    media.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      media.removeEventListener('change', start);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerout', onLeave);
      window.removeEventListener('pointercancel', resetLook);
      window.removeEventListener('blur', resetLook);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [engine, animated, state, shape, expression]);

  return <svg ref={svg} className="bloub" data-state={state} data-character={identity} data-palette={appearance.palette} data-shape={appearance.shape} data-pattern={appearance.pattern} width={size} height={size} viewBox="-158 -158 316 316" role="img" aria-label={label || (identity ? `Ваш персонаж — ${appearance.name}` : 'Блоб — персонаж Career Quest')}>
    <defs>
      <linearGradient id={`color-${id}`} x1="0" y1="0" x2=".85" y2="1"><stop offset="0" stopColor={appearance.highlight}/><stop offset=".65" stopColor={appearance.color}/><stop offset="1" stopColor={appearance.color}/></linearGradient>
      <clipPath id={`clip-${id}`}><path d={frame.bodyPath}/></clipPath>
    </defs>
    <g opacity={frame.bodyAlpha}>
      <path d={frame.bodyPath} fill={`url(#color-${id})`}/>
      <g clipPath={`url(#clip-${id})`}>
        <g data-markings={appearance.pattern} transform={`rotate(${appearance.markRotation})`} fill={appearance.accent}>
          {appearance.pattern === 'freckles' && Array.from({ length: appearance.marks + 2 }, (_, i) => <circle key={i} cx={-44 + i * 17} cy={52 + i % 2 * 11} r={i % 2 ? 4 : 6} opacity=".8"/>)}
          {appearance.pattern === 'spark' && <><path d="M-29 41 L-24 54 L-11 59 L-24 64 L-29 77 L-34 64 L-47 59 L-34 54Z"/><circle cx="0" cy="58" r="4"/><circle cx="15" cy="68" r="3"/></>}
          {appearance.pattern === 'stripes' && <g stroke={appearance.accent} strokeWidth="11" strokeLinecap="round" opacity=".8"><path d="M-84 44 L-43 80"/><path d="M-60 39 L-18 77"/><path d="M-35 35 L7 73"/></g>}
          {appearance.pattern === 'constellation' && <><path d="M-44 62 L-22 48 L3 66 L29 48" fill="none" stroke={appearance.accent} strokeWidth="2.5" opacity=".65"/><circle cx="-44" cy="62" r="4"/><circle cx="-22" cy="48" r="5"/><circle cx="3" cy="66" r="4"/><path d="M29 37 L32 45 L40 48 L32 51 L29 59 L26 51 L18 48 L26 45Z"/></>}
        </g>
        {frame.eyes.map((eye, i) => <path data-eye={i} key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill={appearance.eye}/>)}
      </g>
    </g>
    {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill="#805600"/>}
  </svg>;
}
