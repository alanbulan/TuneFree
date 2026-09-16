import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveAutosource } from '../gdStudioExtras';

const mocks = vi.hoisted(() => ({ fetchData: vi.fn() }));

vi.mock('../gdStudioClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gdStudioClient')>()),
  fetchGDStudioData: mocks.fetchData,
}));

describe('gdStudioExtras', () => {
  beforeEach(() => {
    mocks.fetchData.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveAutosource', () => {
    it('把 autosource 响应还原成完整解析结果（含合并歌词）', async () => {
      mocks.fetchData.mockResolvedValueOnce({
        url: '//audio.test/a.mp3',
        pic: 'http://img.test/a.jpg',
        lyric: '[00:00]主歌词',
        tlyric: '[00:00]translation',
        qrc: '[00:00]<0,10>逐字',
        source: 'tencent',
        id: 'mid-1',
      });

      const result = await resolveAutosource({ name: '晴天', artist: '周杰伦', album: '叶惠美', source: 'embeat' }, 'flac');
      expect(result.url).toContain('audio.test/a.mp3');
      expect(result.pic).toContain('img.test/a.jpg');
      expect(result.lrc).toContain('主歌词');
      expect(result.lrc).toContain('translation');
      // 腾讯在应用侧统一叫 qq
      expect(result.resolvedSource).toBe('qq');
      expect(result.resolvedId).toBe('mid-1');
      expect(result.resolvedLyricId).toBe('mid-1');

      const [params, signal] = mocks.fetchData.mock.calls[0] as [Record<string, unknown>, AbortSignal | undefined];
      expect(params).toMatchObject({ types: 'autosource', source: 'embeat', br: '740' });
      expect(String(params.name)).toContain('晴天');
      expect(signal).toBeUndefined();
    });

    it('缺少 url / 结构异常 / 未知来源都要报错', async () => {
      mocks.fetchData.mockResolvedValueOnce({ lyric: '有词没链' });
      await expect(resolveAutosource({ name: 'a', artist: '', album: '', source: 'embeat' })).rejects.toThrow(
        'missing url',
      );

      mocks.fetchData.mockResolvedValueOnce([{ url: 'x' }]);
      await expect(resolveAutosource({ name: 'a', artist: '', album: '', source: 'embeat' })).rejects.toThrow(
        'must be an object',
      );

      mocks.fetchData.mockResolvedValueOnce({ url: 'https://a.test/x.mp3', source: 'unknown-platform' });
      await expect(resolveAutosource({ name: 'a', artist: '', album: '', source: 'embeat' })).rejects.toThrow(
        'invalid source',
      );
    });

    it('响应里没有来源与 id 时保持语义为空', async () => {
      mocks.fetchData.mockResolvedValueOnce({ url: 'https://a.test/x.mp3' });
      const result = await resolveAutosource({ name: 'a', artist: '', album: '', source: 'embeat' });
      expect(result.resolvedSource).toBeUndefined();
      expect(result.resolvedId).toBeUndefined();
    });
  });
});
