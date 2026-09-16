import { describe, expect, it } from 'vitest';
import { describeContextSearchError, CONTEXT_SEARCH_SETUP_HINT } from '../contextSearch';

describe('语境搜歌失败提示', () => {
  it('未配置模型时引导去设置页', () => {
    for (const message of ['云端推荐未启用或配置不完整', '未保存模型 API Key', '请填写 API 根地址']) {
      const failure = describeContextSearchError(new Error(message));
      expect(failure.needsSetup).toBe(true);
      expect(failure.message).toBe(CONTEXT_SEARCH_SETUP_HINT);
    }
  });

  it('超时单独提示，并给出可调项的指引', () => {
    const failure = describeContextSearchError(new Error('模型服务请求超时'));
    expect(failure.needsSetup).toBe(false);
    expect(failure.message).toContain('超时');
    expect(failure.message).toContain('设置');
  });

  it('没有错误信息时给通用文案，不显示空消息', () => {
    expect(describeContextSearchError(new Error(''))).toEqual({
      message: 'AI 搜歌暂时不可用，请稍后再试。', needsSetup: false,
    });
    expect(describeContextSearchError(undefined)).toEqual({
      message: 'AI 搜歌暂时不可用，请稍后再试。', needsSetup: false,
    });
  });

  it('其他失败保留原始原因，便于排查', () => {
    const failure = describeContextSearchError(new Error('模型服务返回 500'));
    expect(failure.needsSetup).toBe(false);
    expect(failure.message).toBe('AI 搜歌失败：模型服务返回 500');
  });
});
