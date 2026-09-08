import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../proxy', () => ({ proxyFetch: vi.fn(), proxyFetchJson: vi.fn(), proxyFetchJsonWithValidator: vi.fn() }));
vi.mock('../qq', () => ({ qqMusicuFetch: vi.fn() }));
vi.mock('../kuwo', () => ({ batchFetchKuwoCovers: vi.fn((songs) => Promise.resolve(songs)) }));
import { importPlaylist, PlaylistImportError, parsePlaylistImportInput } from '../playlistImport';
import { qqMusicuFetch } from '../qq';
import { batchFetchKuwoCovers } from '../kuwo';
import { proxyFetch, proxyFetchJson, proxyFetchJsonWithValidator } from '../proxy';

const track = (id: number) => ({ id, name: `歌曲 ${id}`, ar: [{ name: '歌手' }], al: { name: '专辑', picUrl: 'http://p.music.126.net/cover.jpg' } });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(batchFetchKuwoCovers).mockImplementation(async (songs) => songs); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('在线歌单导入入口', () => {
  it('网易截断歌单分批补齐，保留稳定身份和封面', async () => {
    const ids = Array.from({ length: 202 }, (_, index) => index + 1);
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({ playlist: {
      name: '完整歌单', tracks: [track(1)], trackIds: ids.map((id) => ({ id })),
    } }).mockResolvedValueOnce({ songs: ids.slice(1, 101).map(track) })
      .mockResolvedValueOnce({ songs: ids.slice(101, 201).map(track) })
      .mockResolvedValueOnce({ songs: [track(202)] });
    const result = await importPlaylist('netease', 'https://music.163.com/playlist?id=123');
    expect(result.name).toBe('完整歌单');
    expect(result.songs).toHaveLength(202);
    expect(new Set(result.songs.map((song) => song.id)).size).toBe(202);
    expect(result.songs[0]).toMatchObject({ id: '1', source: 'netease', pic: 'https://p.music.126.net/cover.jpg' });
    expect(proxyFetchJson).toHaveBeenCalledTimes(4);
    expect(proxyFetchJsonWithValidator).not.toHaveBeenCalled();
  });

  it('直连失败后执行描述符，过滤禁止透传的头', async () => {
    vi.mocked(proxyFetchJson).mockRejectedValue(new DOMException('正文超时', 'TimeoutError'));
    vi.mocked(proxyFetchJsonWithValidator).mockResolvedValue({ data: {
      method: 'POST', url: 'https://example.com/playlists/{{id}}', params: { id: '{{id}}' },
      headers: { Host: 'untrusted', 'X-Playlist': '{{id}}' }, body: { id: '{{parseInt(id)}}' },
    } });
    vi.mocked(proxyFetch).mockResolvedValue(new Response(JSON.stringify({ name: '后备歌单', songs: [track(5)] })));
    const result = await importPlaylist('netease', '123');
    expect(result.songs).toHaveLength(1);
    expect(proxyFetch).toHaveBeenCalledWith('https://example.com/playlists/123?id=123', {
      method: 'POST', headers: { 'X-Playlist': '123', 'Content-Type': 'application/json' }, body: '{"id":123}',
    });
  });

  it('两条请求路径正文失败时返回网络错误，不生成可保存的空歌单', async () => {
    vi.mocked(proxyFetchJson).mockRejectedValue(new DOMException('正文超时', 'TimeoutError'));
    vi.mocked(proxyFetchJsonWithValidator).mockRejectedValue(new Error('network'));
    await expect(importPlaylist('netease', '123')).rejects.toMatchObject({ code: 'network' });
  });

  it('有效但空的歌单返回明确空结果，非法输入不发请求', async () => {
    vi.mocked(proxyFetchJson).mockResolvedValue({ playlist: { tracks: [], trackIds: [] } });
    vi.mocked(proxyFetchJsonWithValidator).mockResolvedValue({ data: null });
    await expect(importPlaylist('netease', '123')).rejects.toMatchObject({ code: 'emptyPlaylist' });
    vi.clearAllMocks();
    await expect(importPlaylist('unsupported', '123')).rejects.toMatchObject({ code: 'unsupportedSource' });
    expect(proxyFetchJson).not.toHaveBeenCalled();
  });
});

describe('QQ、酷我和描述符格式', () => {
  it('QQ 数字 ID 和字符 ID 均保留实际身份，空直连结果进入后备', async () => {
    vi.mocked(qqMusicuFetch).mockResolvedValueOnce({ songlist: [{ songmid: 'm1', name: '歌', singer: [{ name: '人' }] }], dirinfo: { title: 'QQ歌单' } });
    expect((await importPlaylist('qq', 'https://y.qq.com/n/ryqq/playlist/123')).name).toBe('QQ歌单');
    expect(qqMusicuFetch).toHaveBeenCalledWith(expect.objectContaining({ param: expect.objectContaining({ disstid: 123 }) }));
    vi.mocked(qqMusicuFetch).mockResolvedValueOnce({ data: { songList: [{ mid: 'm2', name: '另一首' }] } });
    expect((await importPlaylist('qq', 'list_abc')).name).toBe('list_abc');
    for (const data of [null, {}]) { vi.mocked(qqMusicuFetch).mockResolvedValueOnce(data); await expect(importPlaylist('qq', '42')).rejects.toMatchObject({ code: 'emptyPlaylist' }); }
    vi.mocked(qqMusicuFetch).mockRejectedValueOnce(new PlaylistImportError('unsupportedSource'));
    await expect(importPlaylist('qq', '42')).rejects.toMatchObject({ code: 'unsupportedSource' });
    for (const source of ['toString', 'constructor', '__proto__']) expect(() => parsePlaylistImportInput(source, '42')).toThrow('unsupportedSource');
  });
  it.each([
    '{"title":"酷我","musiclist":[{"rid":1,"name":"歌曲"}]}',
    "{'title':'酷我','musiclist':[{'rid':1,'name':'歌曲'}]}",
    'callback({"title":"酷我","musiclist":[{"rid":1,"name":"歌曲"}]});',
  ])('酷我兼容 JSON、单引号和 JSONP %#', async (text) => {
    vi.mocked(proxyFetch).mockResolvedValueOnce(new Response(text));
    expect(await importPlaylist('kuwo', 'https://www.kuwo.cn/playlist_detail/123')).toMatchObject({ name: '酷我', songs: [{ id: '1', source: 'kuwo' }] });
    expect(batchFetchKuwoCovers).toHaveBeenCalled();
  });
  it('酷我错误结构、无歌曲和无响应不会生成歌单', async () => {
    for (const text of ['bad', 'callback(invalid)', '{}', null]) {
      vi.mocked(proxyFetch).mockResolvedValueOnce(text === null ? null : new Response(text));
      await expect(importPlaylist('kuwo', '123')).rejects.toMatchObject({ code: 'emptyPlaylist' });
    }
  });
  it('描述符模板保留值类型，不执行远端表达式代码，支持 JSONP 与 data 数组', async () => {
    vi.mocked(proxyFetchJsonWithValidator).mockImplementation(async (_url, _options, validator) => {
      expect(validator?.({})).toBe(true); expect(validator?.(null)).toBe(false);
      return { data: { method: 'POST', url: 'https://example.test/list?raw={{id}}',
        body: { text: 'ID={{id}}', values: ['{{missing || id}}', '{{missing || 12}}', "{{missing || 'literal'}}", '{{missing || absent}}', "{{'quoted'}}", 1, null] } } };
    });
    vi.mocked(proxyFetch).mockResolvedValueOnce(new Response('callback({"data":[{"id":1,"name":"歌曲"}]});'));
    const result = await importPlaylist('netease', '123'); expect(result.songs[0].id).toBe('1');
    expect(JSON.parse(String(vi.mocked(proxyFetch).mock.lastCall![1]?.body))).toEqual({ text: 'ID=123', values: ['123', 12, 'literal', '', 'quoted', 1, null] });
    vi.mocked(proxyFetchJsonWithValidator).mockResolvedValue({ data: { method: 'POST', url: 'https://example.test', body: 'id={{id}}' } });
    vi.mocked(proxyFetch).mockResolvedValueOnce(new Response('{"songs":[{"id":1,"name":"歌"}]}'));
    await importPlaylist('netease', '123'); expect(vi.mocked(proxyFetch).mock.lastCall![1]?.body).toBe('id=123');
    for (const text of ['callback(bad)', '{}']) { vi.mocked(proxyFetch).mockResolvedValueOnce(new Response(text)); await expect(importPlaylist('netease', '123')).rejects.toMatchObject({ code: 'emptyPlaylist' }); }
  });
});
