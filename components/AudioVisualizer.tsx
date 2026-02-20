
import React, { useRef, useEffect } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

interface AudioVisualizerProps {
  isPlaying: boolean;
}

// === 可视化配置 ===
const BAR_COUNT = 48;
const SMOOTHING_ALPHA = 0.35;           // 平滑系数 (越低越灵敏)
const RESPONSE_CURVE = 0.7;             // 非线性响应曲线指数
const MIN_BAR_PERCENT = 0.04;           // 最小可见高度百分比
const DECAY_SPEED = 0.92;               // 暂停时衰减系数 (越接近1越慢)

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying }) => {
  const { analyser } = usePlayer();
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

    // 高 DPI 适配
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const dataArray = new Uint8Array(analyser ? analyser.frequencyBinCount : 0);
    let animationId: number = 0;

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
        if ('roundRect' in (ctx as any)) {
            // @ts-ignore
            ctx.roundRect(x, y, w, barHeight, radius);
        } else {
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, h - radius);
            ctx.quadraticCurveTo(x + w, h, x + w - radius, h);
            ctx.lineTo(x + radius, h);
            ctx.quadraticCurveTo(x, h, x, h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
        }
        ctx.fill();
    };

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);

      const totalSpace = width / BAR_COUNT;
      const barWidth = totalSpace * 0.55;
      let x = (totalSpace - barWidth) / 2;

      const state = stateRef.current;

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
              return; // 停止 rAF 循环
          }
      }
    };

    draw();

    return () => cancelAnimationFrame(animationId);
  }, [analyser, isPlaying]);

  return (
    <canvas
        ref={canvasRef}
        className="w-full h-full block"
    />
  );
};

export default AudioVisualizer;
