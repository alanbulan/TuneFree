
import React, { useRef, useEffect } from 'react';
import { usePlayerAnalyser } from '../contexts/PlayerContext';
import {
  BAR_COUNT,
  DECAY_SPEED,
  MIN_BAR_PERCENT,
  RESPONSE_CURVE,
  SMOOTHING_ALPHA,
  calculateVisualizerCanvasSize,
  readVisualizerBarColor,
  renderVisualizerBar,
  shouldScheduleVisualizerFrame,
} from './audioVisualizerCore';

const FRAME_INTERVAL_MS = 1000 / 30;

export { calculateVisualizerCanvasSize, shouldScheduleVisualizerFrame } from './audioVisualizerCore';

interface AudioVisualizerProps {
  isPlaying: boolean;
  /** 为 true 时停止 rAF 循环并清空画布（如实例被全屏播放器完全遮挡时）。 */
  suspended?: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying, suspended = false }) => {
  const { analyser } = usePlayerAnalyser();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 持久化状态，跨帧保留
  const stateRef = useRef({
      simValues: Array.from({ length: BAR_COUNT }, () => 0),
      simTargets: Array.from({ length: BAR_COUNT }, () => 0),
      phase: 0,
      // 当前显示值（用于平滑过渡，包括暂停衰减）
      displayValues: Array.from({ length: BAR_COUNT }, () => 0),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const measured = { size: calculateVisualizerCanvasSize(0, 0, 1) };

    const syncCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextSize = calculateVisualizerCanvasSize(
        rect.width,
        rect.height,
        window.devicePixelRatio || 1,
      );
      const changed =
        nextSize.width !== measured.size.width ||
        nextSize.height !== measured.size.height ||
        nextSize.dpr !== measured.size.dpr;

      if (canvas.width !== nextSize.pixelWidth) canvas.width = nextSize.pixelWidth;
      if (canvas.height !== nextSize.pixelHeight) canvas.height = nextSize.pixelHeight;
      ctx.setTransform(nextSize.dpr, 0, 0, nextSize.dpr, 0, 0);
      measured.size = nextSize;
      return changed;
    };

    syncCanvasSize();

    if (suspended) {
      ctx.clearRect(0, 0, measured.size.width, measured.size.height);
      return;
    }

    // 主题色可缓存：只在初始化与主题变化（themeObserver 回调）时读取，
    // 避免每个 rAF 帧触发 getComputedStyle 强制样式计算
    const drawing = { barColor: readVisualizerBarColor(canvas), animationId: null as number | null, lastFrameAt: null as number | null };

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    const binCount = dataArray.length;
    const logMax = Math.log(Math.max(1, binCount));
    const bins = Array.from({ length: BAR_COUNT }, (_, i) => {
      const start = Math.max(1, Math.round(Math.exp(logMax * i / BAR_COUNT)));
      const end = Math.max(start + 1, Math.round(Math.exp(logMax * (i + 1) / BAR_COUNT)));
      return { start, end };
    });

    const draw = (now = performance.now()) => {
      if (document.hidden) {
        drawing.animationId = null;
        return;
      }
      if (drawing.lastFrameAt !== null && now - drawing.lastFrameAt < FRAME_INTERVAL_MS - 1) {
        drawing.animationId = requestAnimationFrame(draw);
        return;
      }
      // 保持原来 60Hz 下的响应和衰减速度，降低绘制频率不会拖慢动画。
      const elapsedFrames = drawing.lastFrameAt === null ? 1 : Math.min((now - drawing.lastFrameAt) / (1000 / 60), 3.84);
      const riseAlpha = 1 - Math.pow(SMOOTHING_ALPHA, elapsedFrames);
      const fallAlpha = 1 - Math.pow(0.85, elapsedFrames);
      drawing.lastFrameAt = now;
      const width = measured.size.width;
      const height = measured.size.height;
      ctx.clearRect(0, 0, width, height);

      const totalSpace = width / BAR_COUNT;
      const barWidth = totalSpace * 0.92;
      let x = (totalSpace - barWidth) / 2;

      const state = stateRef.current;
      let pauseAnimationSettled = false;

      // 防御性检查：HMR 热更新可能导致旧 stateRef 结构不匹配
      if (!state.displayValues || state.displayValues.length !== BAR_COUNT) {
          state.displayValues = Array.from({ length: BAR_COUNT }, () => 0);
      }
      if (!state.simValues || state.simValues.length !== BAR_COUNT) {
          state.simValues = Array.from({ length: BAR_COUNT }, () => 0);
      }
      if (!state.simTargets || state.simTargets.length !== BAR_COUNT) {
          state.simTargets = Array.from({ length: BAR_COUNT }, () => 0);
      }

      if (isPlaying && analyser) {
          // --- 实时模式（有 AudioContext）---
          analyser.getByteFrequencyData(dataArray);
          // 对数频率映射：低频分配更多柱子，高频压缩
          // 让整个可视化区域都有响应，而不是右侧永远平坦
          for (let i = 0; i < BAR_COUNT; i++) {
            const { start: startBin, end: endBin } = bins[i];

            let sum = 0;
            let count = 0;
            for (let b = startBin; b < endBin && b < binCount; b++) {
                sum += dataArray[b];
                count++;
            }
            const rawValue = count > 0 ? sum / count : 0;
            // 非线性响应
            let percent = Math.max(0, Math.min(1, rawValue / 255));
            percent = Math.pow(percent, RESPONSE_CURVE);

            // 平滑：上升快，下降慢
            if (percent > state.displayValues[i]) {
                state.displayValues[i] += (percent - state.displayValues[i]) * riseAlpha;
            } else {
                state.displayValues[i] += (percent - state.displayValues[i]) * fallAlpha;
            }

            renderVisualizerBar(ctx, x, state.displayValues[i], height, barWidth, drawing.barColor);
            x += totalSpace;
          }

      } else if (isPlaying && !analyser) {
          // --- 模拟模式（无 AudioContext，播放中）---
          state.phase += 0.03 * elapsedFrames;

          const kickChance = 1 - Math.pow(0.95, elapsedFrames);
          if (Math.random() < kickChance) {
              const kickStrength = 180 + Math.random() * 75;
              for (let i = 0; i < 12; i++) {
                   const decay = 1 - (i / 12);
                   state.simTargets[i] = Math.max(state.simTargets[i], kickStrength * decay);
              }
          }

          for (let i = 0; i < BAR_COUNT; i++) {
              const baseProfile = Math.max(0, 80 - i);
              const noise = (Math.sin(i * 0.3 + state.phase) + Math.sin(i * 0.7 - state.phase)) * 20;
              let target = baseProfile + Math.abs(noise);
              if (i > 15 && Math.random() < kickChance) {
                  target += Math.random() * 100 * (i / BAR_COUNT);
              }
              state.simTargets[i] = Math.max(state.simTargets[i], target);
          }

          const simulatedAlpha = 1 - Math.pow(0.7, elapsedFrames);
          for (let i = 0; i < BAR_COUNT; i++) {
             state.simTargets[i] -= 3 * elapsedFrames;
             if (state.simTargets[i] < 0) state.simTargets[i] = 0;
             const diff = state.simTargets[i] - state.simValues[i];
             state.simValues[i] += diff * simulatedAlpha;

             let percent = Math.max(0, Math.min(1, state.simValues[i] / 255));
             percent = Math.pow(percent, RESPONSE_CURVE);
             state.displayValues[i] = percent;

             renderVisualizerBar(ctx, x, percent, height, barWidth, drawing.barColor);
             x += totalSpace;
          }

      } else {
          // --- 暂停状态：柱子平滑衰减到最小高度 ---
          let allSettled = true;
          const decay = Math.pow(DECAY_SPEED, elapsedFrames);
          for (let i = 0; i < BAR_COUNT; i++) {
              state.displayValues[i] *= decay;
              if (state.displayValues[i] > MIN_BAR_PERCENT + 0.005) {
                  allSettled = false;
              }
              renderVisualizerBar(ctx, x, state.displayValues[i], height, barWidth, drawing.barColor);
              x += totalSpace;
          }

          // 完全衰减后停止动画，减少 CPU 消耗
          if (allSettled) {
              // 最后一帧：绘制静态最小柱子
              ctx.clearRect(0, 0, width, height);
              x = (totalSpace - barWidth) / 2;
              for (let i = 0; i < BAR_COUNT; i++) {
                  state.displayValues[i] = 0;
                  renderVisualizerBar(ctx, x, MIN_BAR_PERCENT, height, barWidth, drawing.barColor);
                  x += totalSpace;
              }
              pauseAnimationSettled = true;
          }
      }

      if (shouldScheduleVisualizerFrame(isPlaying, pauseAnimationSettled, suspended)) {
        drawing.animationId = requestAnimationFrame(draw);
      } else {
        drawing.animationId = null;
        drawing.lastFrameAt = null;
      }
    };

    draw();

    const handleVisibility = () => {
      if (document.hidden) {
        if (drawing.animationId !== null) cancelAnimationFrame(drawing.animationId);
        drawing.animationId = null;
        drawing.lastFrameAt = null;
      } else if (drawing.animationId === null) draw();
    };

    const handleResize = () => {
      if (syncCanvasSize() && drawing.animationId === null) draw();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handleResize);
    const themeObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
        drawing.barColor = readVisualizerBarColor(canvas);
        if (drawing.animationId === null) draw();
      });
    resizeObserver?.observe(canvas);
    // 主题色可能随 class（深/浅色）或 style（主题变量下发）变化，两者都要重读缓存的颜色
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (drawing.animationId !== null) cancelAnimationFrame(drawing.animationId);
    };
  }, [analyser, isPlaying, suspended]);

  return (
    <canvas ref={canvasRef} className="audio-visualizer-canvas" />
  );
};

export default AudioVisualizer;
