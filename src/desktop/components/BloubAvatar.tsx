import { memo, useEffect, useId, useRef, useState } from 'react';
import { BotEngine, type BotFrame } from '../../../vendor/bloub/src/bot/engine';
import { NOTIF_BLUE } from '../../../vendor/bloub/src/bot/decor';
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID, type ExpressionId } from '../../../vendor/bloub/src/bot/expressions';
import { clamp, easings } from '../../../vendor/bloub/src/bot/math';
import { DEMI_VIEWBOX as VB, RAYON as R } from '../../../vendor/bloub/src/bot/repere';
import { COLOR_BY_ID, DEFAULT_SHAPE, SHAPE_BY_ID, mixHex, type ShapeId } from '../../../vendor/bloub/src/bot/skins';
import { POSES, STATE_BY_ID, type StateId } from '../../../vendor/bloub/src/bot/states';
import { lookTarget, TURN_TIME } from '../../../vendor/bloub/src/ui/gaze';

interface BloubAvatarProps {
  state: StateId;
  frozen: boolean;
  expression?: ExpressionId;
  shape?: ShapeId;
  followPointer?: boolean;
}

const createEngine = (state: StateId, expression: ExpressionId, shape: ShapeId) => new BotEngine(
  R, state, SHAPE_BY_ID.get(shape)?.radii ?? null,
  EXPRESSION_BY_ID.get(expression) ?? null,
);
const FRAME_INTERVAL_MS = 1000 / 60;

/** 仅适配官方组件的时钟与指针生命周期，测量数据和形变计算仍来自上游。 */
function useBloubFrame(state: StateId, frozen: boolean, expression: ExpressionId, shape: ShapeId, followPointer: boolean) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [engine] = useState(() => createEngine(state, expression, shape));
  const clockRef = useRef(0);
  const [frame, setFrame] = useState(() => engine.sample(frozen ? POSES[state] : 0));

  useEffect(() => {
    engine.setState(state, clockRef.current);
    engine.setExpression(EXPRESSION_BY_ID.get(expression) ?? null, clockRef.current);
    engine.setShape(SHAPE_BY_ID.get(shape)?.radii ?? null, clockRef.current);
    // 在当前状态进入完成后取一个静止帧；恢复时从这一帧继续，避免回跳。
    if (frozen) clockRef.current += Math.max(POSES[state], STATE_BY_ID.get(state)!.morph);
    setFrame(engine.sample(clockRef.current));
  }, [engine, state, frozen, expression, shape]);

  useEffect(() => {
    if (frozen) return;
    const loop = { raf: 0, last: 0, pointer: null as { x: number; y: number } | null,
      aiming: false, turnSince: clockRef.current };
    const bounds = { rect: null as DOMRect | null };
    const invalidateBox = () => { bounds.rect = null; };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        loop.pointer = { x: event.clientX, y: event.clientY };
        invalidateBox();
      }
    };
    const onPointerLeave = () => { loop.pointer = null; };
    const aim = () => {
      const clock = clockRef.current;
      if (!STATE_BY_ID.get(engine.state)?.baseFace) {
        if (loop.aiming) engine.setLook(null, clock, TURN_TIME);
        loop.aiming = false;
        return;
      }
      bounds.rect ??= svgRef.current?.getBoundingClientRect() ?? null;
      const box = bounds.rect;
      if (!box || box.width === 0 || box.height === 0) return;
      if (!loop.aiming) loop.turnSince = clock;
      engine.setLook(lookTarget({
        nx: loop.pointer ? clamp((loop.pointer.x - box.left - box.width / 2) / Math.max(1, window.innerWidth / 2), -1, 1) : 0,
        ny: loop.pointer ? clamp((loop.pointer.y - box.top - box.height / 2) / Math.max(1, window.innerHeight / 2), -1, 1) : 0,
        tour: easings.easeOutQuint(clamp((clock - loop.turnSince) / TURN_TIME)),
        pointer: loop.pointer !== null,
      }), clock);
      loop.aiming = true;
    };
    const tick = (ms: number) => {
      // 120/144Hz 屏幕无需同频重建装饰 SVG；保持 60Hz，动画时钟仍按真实经过时间前进。
      if (loop.last && ms - loop.last < FRAME_INTERVAL_MS - 1) {
        loop.raf = window.requestAnimationFrame(tick);
        return;
      }
      // 沿用官方 64ms 上限，恢复窗口时不跳过一大段动画。
      clockRef.current += loop.last ? Math.min((ms - loop.last) / 1000, 0.064) : 0;
      loop.last = ms;
      if (followPointer) aim();
      setFrame(engine.sample(clockRef.current));
      loop.raf = window.requestAnimationFrame(tick);
    };
    if (followPointer) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerleave', onPointerLeave);
      window.addEventListener('resize', invalidateBox);
      window.addEventListener('scroll', invalidateBox, true);
    }
    const observer = followPointer && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidateBox) : null;
    if (svgRef.current) observer?.observe(svgRef.current);
    loop.raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(loop.raf);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', invalidateBox);
      window.removeEventListener('scroll', invalidateBox, true);
      observer?.disconnect();
      engine.setLook(null, clockRef.current, TURN_TIME);
    };
  }, [engine, frozen, followPointer]);

  return { frame, svgRef };
}

function BotDots({ dots, ink, paper }: { dots: BotFrame['dots']; ink: string; paper: string }) {
  return (
    <g>
      {dots.map((dot, index) => {
        const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
        return dot.d ? (
          <path key={index} d={dot.d} fill={fill} opacity={dot.opacity}
            transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`} />
        ) : <circle key={index} cx={dot.x} cy={dot.y} r={dot.r} fill={fill} opacity={dot.opacity} />;
      })}
    </g>
  );
}

/** 官方 SVG 结构的 React 适配；不是上游发布的 React 组件。 */
function BloubAvatar({ state, frozen, expression = DEFAULT_EXPRESSION, shape = DEFAULT_SHAPE, followPointer = true }: BloubAvatarProps) {
  const { frame, svgRef } = useBloubFrame(state, frozen, expression, shape, followPointer);
  const uid = `bloub-${useId().replace(/:/g, '')}`;
  const maskId = `${uid}-mask`;
  const [palette, setPalette] = useState({ ink: '#0a0a0c', paper: '#f6f6f8' });

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      const color = root.classList.contains('dark-theme') ? 'creme' : 'encre';
      const ink = COLOR_BY_ID.get(color)?.hex ?? '#0a0a0c';
      const paper = getComputedStyle(root).getPropertyValue('--ios-bg').trim() || '#f6f6f8';
      setPalette((previous) => previous.ink === ink && previous.paper === paper ? previous : { ink, paper });
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);

  return (
    <svg ref={svgRef} className="bloub-avatar" width={112} height={112}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`} aria-hidden="true">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, index) => (
            <path key={index} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient key={arc.id} id={`${uid}-${arc.id}`} gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1} y1={arc.grad.y1} x2={arc.grad.x2} y2={arc.grad.y2}>
            {arc.grad.stops.map((color, index) => (
              <stop key={index} offset={index / (arc.grad.stops.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={arc.id} d={arc.back} stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
      {frame.dotsBehind && <BotDots dots={frame.dots} {...palette} />}
      <g opacity={frame.bodyAlpha}>
        {/* 官方的眼睛是遮罩开孔；底色阻止后方轨道从眼睛中透出。 */}
        <path d={frame.bodyPath} fill={palette.paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={palette.ink} />
        </g>
      </g>
      {!frame.dotsBehind && <BotDots dots={frame.dots} {...palette} />}
      {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={arc.id} d={arc.front} stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
    </svg>
  );
}

export default memo(BloubAvatar);
