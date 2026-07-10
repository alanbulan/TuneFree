
import React, { useRef, useEffect } from 'react';
import { usePlayerAnalyser } from '../contexts/PlayerContext';

interface AudioVisualizerProps {
  isPlaying: boolean;
}

// === 可视化配置 ===
const BAR_COUNT = 220;
const SMOOTHING_ALPHA = 0.35;           // 平滑系数 (越低越灵敏)
const RESPONSE_CURVE = 0.7;             // 非线性响应曲线指数
const MIN_BAR_PERCENT = 0.04;           // 最小可见高度百分比
const DECAY_SPEED = 0.92;               // 暂停时衰减系数 (越接近1越慢)

export const shouldScheduleVisualizerFrame = (
  isPlaying: boolean,
  pauseAnimationSettled: boolean,
): boolean => isPlaying || !pauseAnimationSettled;

export const calculateVisualizerCanvasSize = (
  width: number,
  height: number,
  devicePixelRatio: number,
) => {
  const logicalWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const logicalHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: logicalWidth,
    height: logicalHeight,
    dpr,
    pixelWidth: Math.max(1, Math.round(logicalWidth * dpr)),
    pixelHeight: Math.max(1, Math.round(logicalHeight * dpr)),
  };
};

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying }) => {
  const { analyser } = usePlayerAnalyser();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 持久化状态，跨帧保留
  const stateRef = useRef({
      simValues: new Array(BAR_COUNT).fill(0),
      simTargets: new Array(BAR_COUNT).fill(0),
      phase: 0,
      // 当前显示值（用于平滑过渡，包括暂停衰减）
      displayValues: new Array(BAR_COUNT).fill(0),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let canvasSize = calculateVisualizerCanvasSize(0, 0, 1);

    const syncCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const nextSize = calculateVisualizerCanvasSize(
        rect.width,
        rect.height,
        window.devicePixelRatio || 1,
      );
      const changed =
        nextSize.width !== canvasSize.width ||
        nextSize.height !== canvasSize.height ||
        nextSize.dpr !== canvasSize.dpr;

      if (canvas.width !== nextSize.pixelWidth) canvas.width = nextSize.pixelWidth;
      if (canvas.height !== nextSize.pixelHeight) canvas.height = nextSize.pixelHeight;
      ctx.setTransform(nextSize.dpr, 0, 0, nextSize.dpr, 0, 0);
      canvasSize = nextSize;
      return changed;
    };

    syncCanvasSize();

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    let animationId: number | null = null;

    // === 渲染单个柱子（简洁风格，无峰值指示器）===
    const renderBar = (
        ctx: CanvasRenderingContext2D,
        x: number,
        percent: number,
        h: number,
        w: number,
    ) => {
        if (percent < MIN_BAR_PERCENT) percent = MIN_BAR_PERCENT;

        const barHeight = percent * h;
        const radius = w / 2;
        const y = h - barHeight;

        // 简洁深色风格 — 强度越大越不透明
        const alpha = 0.12 + percent * 0.38;
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;

        // 绘制圆角柱子
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, w, barHeight, radius);
        } else {
            ctx.moveTo(x + radius, y);
            ctx.arcTo(x + w, y, x + w, y + radius, radius);
            ctx.lineTo(x + w, y + barHeight - radius);
            ctx.arcTo(x + w, y + barHeight, x + w - radius, y + barHeight, radius);
            ctx.lineTo(x + radius, y + barHeight);
            ctx.arcTo(x, y + barHeight, x, y + barHeight - radius, radius);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
        }
        ctx.fill();
    };

    const draw = () => {
      const width = canvasSize.width;
      const height = canvasSize.height;
      ctx.clearRect(0, 0, width, height);

      const totalSpace = width / BAR_COUNT;
      const barWidth = totalSpace * 0.92;
      let x = (totalSpace - barWidth) / 2;

      const state = stateRef.current;
      let pauseAnimationSettled = false;

      // 防御性检查：HMR 热更新可能导致旧 stateRef 结构不匹配
      if (!state.displayValues || state.displayValues.length !== BAR_COUNT) {
          state.displayValues = new Array(BAR_COUNT).fill(0);
      }
      if (!state.simValues || state.simValues.length !== BAR_COUNT) {
          state.simValues = new Array(BAR_COUNT).fill(0);
      }
      if (!state.simTargets || state.simTargets.length !== BAR_COUNT) {
          state.simTargets = new Array(BAR_COUNT).fill(0);
      }

      if (isPlaying && analyser) {
          // --- 实时模式（有 AudioContext）---
          analyser.getByteFrequencyData(dataArray);
          const binCount = dataArray.length;

          // 对数频率映射：低频分配更多柱子，高频压缩
          // 让整个可视化区域都有响应，而不是右侧永远平坦
          const logMax = Math.log(binCount);
          for (let i = 0; i < BAR_COUNT; i++) {
            const startBin = Math.max(1, Math.round(Math.exp(logMax * i / BAR_COUNT)));
            const endBin = Math.max(startBin + 1, Math.round(Math.exp(logMax * (i + 1) / BAR_COUNT)));

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
                state.displayValues[i] += (percent - state.displayValues[i]) * (1 - SMOOTHING_ALPHA);
            } else {
                state.displayValues[i] += (percent - state.displayValues[i]) * 0.15;
            }

            renderBar(ctx, x, state.displayValues[i], height, barWidth);
            x += totalSpace;
          }

      } else if (isPlaying && !analyser) {
          // --- 模拟模式（无 AudioContext，播放中）---
          state.phase += 0.03;

          if (Math.random() < 0.05) {
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
              if (i > 15 && Math.random() < 0.05) {
                  target += Math.random() * 100 * (i / BAR_COUNT);
              }
              state.simTargets[i] = Math.max(state.simTargets[i], target);
          }

          for (let i = 0; i < BAR_COUNT; i++) {
             state.simTargets[i] -= 3;
             if (state.simTargets[i] < 0) state.simTargets[i] = 0;
             const diff = state.simTargets[i] - state.simValues[i];
             state.simValues[i] += diff * 0.3;

             let percent = Math.max(0, Math.min(1, state.simValues[i] / 255));
             percent = Math.pow(percent, RESPONSE_CURVE);
             state.displayValues[i] = percent;

             renderBar(ctx, x, percent, height, barWidth);
             x += totalSpace;
          }

      } else {
          // --- 暂停状态：柱子平滑衰减到最小高度 ---
          let allSettled = true;
          for (let i = 0; i < BAR_COUNT; i++) {
              state.displayValues[i] *= DECAY_SPEED;
              if (state.displayValues[i] > MIN_BAR_PERCENT + 0.005) {
                  allSettled = false;
              }
              renderBar(ctx, x, state.displayValues[i], height, barWidth);
              x += totalSpace;
          }

          // 完全衰减后停止动画，减少 CPU 消耗
          if (allSettled) {
              // 最后一帧：绘制静态最小柱子
              ctx.clearRect(0, 0, width, height);
              x = (totalSpace - barWidth) / 2;
              for (let i = 0; i < BAR_COUNT; i++) {
                  state.displayValues[i] = 0;
                  renderBar(ctx, x, MIN_BAR_PERCENT, height, barWidth);
                  x += totalSpace;
              }
              pauseAnimationSettled = true;
          }
      }

      if (shouldScheduleVisualizerFrame(isPlaying, pauseAnimationSettled)) {
        animationId = requestAnimationFrame(draw);
      } else {
        animationId = null;
      }
    };

    draw();

    const handleResize = () => {
      if (syncCanvasSize() && animationId === null) draw();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handleResize);
    resizeObserver?.observe(canvas);
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  }, [analyser, isPlaying]);

  return (
    <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
};

export default AudioVisualizer;
