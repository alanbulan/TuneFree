import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../ipc/commands', () => ({ invokeCommand: vi.fn() }));
vi.mock('../../ipc/env', () => ({ isTauri: () => true }));
import { invokeCommand } from '../../ipc/commands';
import { getLlmConfig, saveLlmConfig, syncRecommendationLibrary, attachRecommendationMeta } from '../recommendation';
import type { LlmConfigView } from '../../ipc/types';

const key = 'tunefree_local_recommendation_enabled';
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('推荐配置和稳定数据边界', () => {
  it('晚到的旧配置不能覆盖刚保存的启用状态', async () => {
    let finish: (config: LlmConfigView) => void = () => {};
    vi.mocked(invokeCommand).mockImplementationOnce(() => new Promise<LlmConfigView>((resolve) => { finish = resolve; }));
    const pending = getLlmConfig();
    vi.mocked(invokeCommand).mockResolvedValueOnce(undefined);
    await saveLlmConfig({ localRecommendationEnabled: true, enabled: false, baseUrl: '', model: '' });
    finish({ localRecommendationEnabled: false } as LlmConfigView);
    await pending;
    expect(localStorage.getItem(key)).toBe('true');
  });

  it('配置保存失败不改变本地开关，也不发成功事件', async () => {
    localStorage.setItem(key, 'false');
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    vi.mocked(invokeCommand).mockRejectedValue(new Error('保存失败'));
    await expect(saveLlmConfig({ localRecommendationEnabled: true, enabled: false, baseUrl: '', model: '' })).rejects.toThrow('保存失败');
    expect(localStorage.getItem(key)).toBe('false');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('同步以后台开关为准，传输时剔除临时地址和歌词', async () => {
    localStorage.setItem(key, 'false');
    vi.mocked(invokeCommand).mockResolvedValue(true);
    await expect(syncRecommendationLibrary({ favorites: [{ id: '1', source: 'qq', name: '歌',
      artist: '歌手', album: '', urlId: 'stable', url: 'temporary', lrc: 'large lyrics' }], playlists: [], queue: [] })).resolves.toBe(true);
    expect(invokeCommand).toHaveBeenCalledWith('sync_recommendation_library', { snapshot: {
      favorites: [{ id: '1', source: 'qq', name: '歌', artist: '歌手', album: '', urlId: 'stable' }],
      playlists: [], queue: [], currentSong: null,
    } });
  });

  it('旧推荐结果的失效会话封面不会重新进入界面', () => {
    const [song] = attachRecommendationMeta([{ song: { id: '1', source: 'qq', name: '歌', artist: '歌手',
      album: '', pic: 'http://127.0.0.1:40000/temporary?token=old' }, score: 1,
    reasons: [], recommendationSource: 'local', requestId: 'request' }]);
    expect(song.pic).toBe('');
  });
});
