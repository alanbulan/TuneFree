/**
 * Pure helpers and drawing primitives for the audio visualizer canvas,
 * extracted so the component stays small and the math stays unit-testable.
 */

// === 可视化配置 ===
export const BAR_COUNT = 220;
export const SMOOTHING_ALPHA = 0.35;           // 平滑系数 (越低越灵敏)
export const RESPONSE_CURVE = 0.7;             // 非线性响应曲线指数
export const MIN_BAR_PERCENT = 0.04;           // 最小可见高度百分比
export const DECAY_SPEED = 0.92;               // 暂停时衰减系数 (越接近1越慢)

export const shouldScheduleVisualizerFrame = (
  isPlaying: boolean,
  pauseAnimationSettled: boolean,
  suspended = false,
): boolean => !suspended && (isPlaying || !pauseAnimationSettled);

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

/** 读取当前主题下的柱状条颜色；只应在初始化与主题变化时调用。 */
export const readVisualizerBarColor = (canvas: HTMLCanvasElement): string =>
  getComputedStyle(canvas).getPropertyValue('--visualizer-bar-rgb').trim() || '0, 0, 0';

// === 渲染单个柱子（简洁风格，无峰值指示器）===
export const renderVisualizerBar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  percent: number,
  h: number,
  w: number,
  color: string,
) => {
  if (percent < MIN_BAR_PERCENT) percent = MIN_BAR_PERCENT;

  const barHeight = percent * h;
  const radius = w / 2;
  const y = h - barHeight;

  // 颜色跟随当前主题，强度越大越不透明
  const alpha = 0.12 + percent * 0.38;
  ctx.fillStyle = `rgba(${color}, ${alpha})`;

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
