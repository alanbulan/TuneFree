/**
 * 逐字歌词的时钟状态计算，供主界面逐字渲染与同步翻译渲染共用。
 */

export type LyricWordState = 'pending' | 'active' | 'done';

/** 解析某个逐字单元在给定播放时刻的三态。 */
export const getLyricWordState = (
  start: number,
  duration: number,
  currentTime: number,
): LyricWordState => {
  if (duration === 0) return currentTime < start ? 'pending' : 'done';
  if (currentTime >= start + duration) return 'done';
  if (currentTime >= start) return 'active';
  return 'pending';
};

/** 解析某个逐字单元在给定播放时刻的 0..1 填充比例。 */
export const getLyricWordProgress = (
  start: number,
  duration: number,
  currentTime: number,
): number => {
  if (duration === 0) return currentTime < start ? 0 : 1;
  return Math.max(0, Math.min(1, (currentTime - start) / duration));
};

/**
 * 把 0..1 的比例格式化成 CSS `--word-progress` 百分比字符串（如 "37.5%"），
 * 供渐变文字填充规则使用。
 */
export const formatWordProgress = (progress: number): string => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return `${(clamped * 100).toFixed(1)}%`;
};
