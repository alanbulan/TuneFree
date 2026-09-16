import type { Song } from '../../../core/types';

export const attachContextSearchMeta = (
  songs: Song[],
  requestId: string,
): Song[] => songs.map((song) => ({
  ...song,
  recommendationRequestId: requestId,
  recommendationSource: 'embeat',
}));

export const isCurrentContextSearch = (
  requestId: number,
  currentRequestId: number,
  activeSource: string,
): boolean => requestId === currentRequestId && activeSource === 'embeat';

/** 语境搜歌失败的分类：缺配置要引导去设置页，其余按服务不可用处理。 */
export interface ContextSearchFailure {
  message: string;
  /** 是否因为模型没配好——界面据此显示「打开设置」按钮。 */
  needsSetup: boolean;
}

const SETUP_MARKERS = [
  '未启用', '配置不完整', 'API Key', 'API 根地址', '请填写',
];

/** 未配置模型时的引导文案，与设置页的字段名保持一致。 */
export const CONTEXT_SEARCH_SETUP_HINT =
  'AI 搜歌需要先配置 OpenAI 兼容模型：在设置中填写 API 根地址、模型和 API Key。';

/**
 * 把后端错误翻译成用户能行动的提示。
 *
 * 语境搜歌现在走用户自己配置的 OpenAI 兼容服务，最常见的失败就是「还没配」，
 * 这跟「服务挂了」要给完全不同的引导。
 */
export const describeContextSearchError = (cause: unknown): ContextSearchFailure => {
  const raw = cause instanceof Error ? cause.message : String(cause ?? '');
  if (SETUP_MARKERS.some((marker) => raw.includes(marker))) {
    return { message: CONTEXT_SEARCH_SETUP_HINT, needsSetup: true };
  }
  if (raw.includes('超时')) {
    return { message: '模型服务响应超时，请稍后再试，或在设置中调大超时时间。', needsSetup: false };
  }
  if (!raw.trim()) {
    return { message: 'AI 搜歌暂时不可用，请稍后再试。', needsSetup: false };
  }
  return { message: `AI 搜歌失败：${raw}`, needsSetup: false };
};
