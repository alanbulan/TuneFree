
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

    if (suspended) {
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
      return;
    }

    // 主题色可缓存：只在初始化与主题变化（themeObserver 回调）时读取，
    // 避免每个 rAF 帧触发 getComputedStyle 强制样式计算
    let barColor = readVisualizerBarColor(canvas);

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    let animationId: number | null = null;

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

            renderVisualizerBar(ctx, x, state.displayValues[i], height, barWidth, barColor);
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

             renderVisualizerBar(ctx, x, percent, height, barWidth, barColor);
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
              renderVisualizerBar(ctx, x, state.displayValues[i], height, barWidth, barColor);
              x += totalSpace;
          }

          // 完全衰减后停止动画，减少 CPU 消耗
          if (allSettled) {
              // 最后一帧：绘制静态最小柱子
              ctx.clearRect(0, 0, width, height);
              x = (totalSpace - barWidth) / 2;
              for (let i = 0; i < BAR_COUNT; i++) {
                  state.displayValues[i] = 0;
                  renderVisualizerBar(ctx, x, MIN_BAR_PERCENT, height, barWidth, barColor);
                  x += totalSpace;
              }
              pauseAnimationSettled = true;
          }
      }

      if (shouldScheduleVisualizerFrame(isPlaying, pauseAnimationSettled, suspended)) {
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
    const themeObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
        barColor = readVisualizerBarColor(canvas);
        if (animationId === null) draw();
      });
    resizeObserver?.observe(canvas);
    // 主题色可能随 class（深/浅色）或 style（主题变量下发）变化，两者都要重读缓存的颜色
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
      if (animationId !== null) cancelAnimationFrame(animationId);
    };
  }, [analyser, isPlaying, suspended]);

  return (
    <canvas ref={canvasRef} className="audio-visualizer-canvas" />
  );
};

export default AudioVisualizer;
