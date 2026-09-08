import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflate } from 'pako';
import { batchFetchKuwoCovers, fetchKuwoLyrics, getKuwoTopListDetail, getKuwoTopLists, searchKuwo } from '../kuwo';
import { getProxies, proxyFetchJson } from '../proxy';
import { SELF_HOSTED_PROXY } from '../config';
import { parseLyrics } from '../../utils/lyrics';
import type { Song } from '../../types';

vi.mock('../proxy', async (original) => ({ ...await original<typeof import('../proxy')>(), getProxies: vi.fn(), proxyFetchJson: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const song = (id: string, pic = ''): Song => ({ id, name: '测试', artist: '', album: '', source: 'kuwo', pic });
// 独立构造协议夹具：ASCII 属于 GB18030 的兼容子集，压缩包可带原接口头。
function lrcxResponse(text: string, header = true) {
  const key = new TextEncoder().encode('yeelion');
  const bytes = new TextEncoder().encode(text).map((byte, index) => byte ^ key[index % key.length]);
  const compressed = deflate(btoa(String.fromCharCode(...bytes)));
  const prefix = header ? new TextEncoder().encode('lrcx\r\n\r\n') : new Uint8Array();
  const payload = new Uint8Array(prefix.length + compressed.length);
  payload.set(prefix); payload.set(compressed, prefix.length);
  return new Response(payload);
}

beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getProxies).mockReturnValue([SELF_HOSTED_PROXY, 'https://proxy.test/?url=']);
  vi.mocked(proxyFetchJson).mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('酷我搜索与封面', () => {
  it('保留已有封面和无 ID 项，单首失败不影响其他歌曲', async () => {
    fetchMock.mockResolvedValueOnce(new Response(' http://img.test/1.jpg '))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('not an image'))
      .mockResolvedValueOnce(new Response('http://img.test/error.jpg', { status: 500 }));
    const empty: Song[] = [];
    expect(await batchFetchKuwoCovers(empty)).toBe(empty);
    const songs = [song('1'), song('2'), song('3'), song('4'), song('5', 'https://img.test/kept.jpg'), song('')];
    const result = await batchFetchKuwoCovers(songs);
    expect(result[0].pic).toBe('http://img.test/1.jpg');
    expect(result.slice(1)).toEqual(songs.slice(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit', headers: expect.anything() });
  });

  it('解析旧版单引号格式、HTML 空格和不同 ID，并补齐封面', async () => {
    vi.mocked(getProxies).mockReturnValue(['https://proxy.test/?url=']);
    fetchMock.mockResolvedValueOnce(new Response("{'abslist':[{'MUSICRID':'MUSIC_42','SONGNAME':'夜&nbsp;曲','ARTIST':' 周&nbsp;杰伦 ','ALBUM':' 专&nbsp;辑 '},{'DC_TARGETID':43,'NAME':'另一首'},{}]}"))
      .mockImplementation(() => Promise.resolve(new Response('http://img.test/cover.jpg')));
    const songs = await searchKuwo('夜 曲', 2, 20);
    expect(songs[0]).toMatchObject({ id: '42', name: '夜 曲', artist: '周 杰伦', album: '专 辑', source: 'kuwo' });
    expect(songs[1]).toMatchObject({ id: '43', name: '另一首', artist: '', album: '' });
    expect(songs[2].id).not.toBe('');
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain('pn=1&rn=20');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ mode: 'cors', credentials: 'omit' });
  });

  it('失败代理释放响应体并尝试下一个，空列表是成功结果', async () => {
    const bad = new Response('busy', { status: 503 });
    const cancel = vi.spyOn(bad.body!, 'cancel');
    fetchMock.mockResolvedValueOnce(bad).mockResolvedValueOnce(new Response('{"abslist":[]}'));
    expect(await searchKuwo('空', 1, 10)).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(new Response('broken')).mockResolvedValueOnce(new Response('{}'));
    await expect(searchKuwo('失败', 1, 10)).rejects.toThrow('酷我搜索响应不可用');
  });

  it('请求被取消时传播取消原因', async () => {
    const controller = new AbortController(); controller.abort(new Error('stop-search'));
    fetchMock.mockRejectedValue(new Error('network aborted'));
    await expect(searchKuwo('取消', 1, 10, controller.signal)).rejects.toThrow('stop-search');
  });
});

describe('酷我榜单', () => {
  it('兼容两种封面字段和单个榜单失败', async () => {
    vi.mocked(proxyFetchJson).mockRejectedValueOnce(new Error('one chart failed'))
      .mockResolvedValueOnce({ v9_pic2: 'http://img.test/a' }).mockResolvedValueOnce({ pic: 'http://img.test/b' });
    const charts = await getKuwoTopLists();
    expect(charts).toHaveLength(7);
    expect(charts[0]).toMatchObject({ id: '93', coverImgUrl: '' });
    expect(charts[1].coverImgUrl).toBe('http://img.test/a');
    expect(charts[2].coverImgUrl).toBe('http://img.test/b');
  });
  it('榜单歌曲正常归一化，缺失列表返回空值', async () => {
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({ musiclist: [{ id: 9, name: '歌', artist: '人', album: '专辑' }, {}] });
    fetchMock.mockResolvedValue(new Response('http://img.test/a'));
    expect(await getKuwoTopListDetail('93')).toEqual([song('9', 'http://img.test/a')].map((item) => ({ ...item, name: '歌', artist: '人', album: '专辑' })).concat([{ ...song(''), name: '' }]));
    expect(await getKuwoTopListDetail('bad')).toEqual([]);
  });
});

describe('酷我歌词协议', () => {
  it('真实压缩/XOR 夹具转成逐字时间轴，并保留普通歌词', async () => {
    vi.mocked(proxyFetchJson).mockResolvedValue({ data: { lrclist: [{ time: '1', lineLyric: 'Hello world' }] } });
    fetchMock.mockResolvedValue(lrcxResponse('[kuwo:15]\n[00:01.00]<3000,-3000>Hello <2500,-500>world\n[00:04.00]no words\n[00:05.00]<2,2>zero'));
    const lyrics = await fetchKuwoLyrics(42);
    expect(parseLyrics(lyrics)[0].words).toEqual([
      { start: 1, duration: 1, text: 'Hello ' }, { start: 2, duration: 0.5, text: 'world' },
    ]);
    expect(lyrics).toContain('[tunefree:karaoke]');
    expect(String(fetchMock.mock.calls[0][0])).toContain('newlyric.lrc');
  });

  it('无头压缩包和 MUSIC_ 前缀可用，主歌词缺失时保留逐字歌词', async () => {
    fetchMock.mockResolvedValue(lrcxResponse('[kuwo:15]\n[00:01.00]<3000,-3000>Hello', false));
    expect(parseLyrics(await fetchKuwoLyrics('MUSIC_42'))[0].text).toBe('Hello');
    expect(vi.mocked(proxyFetchJson).mock.calls[1][0]).toContain('httpsStatus=1');
  });

  it.each(['invalid', '[kuwo:1]', '[kuwo:12]', '[kuwo:15]\n[00:01.00]nothing'])('无效逐字内容 %s 降级到普通歌词', async (text) => {
    fetchMock.mockImplementation(() => Promise.resolve(lrcxResponse(text)));
    vi.mocked(proxyFetchJson).mockResolvedValueOnce(null).mockResolvedValueOnce({ data: { lrclist: [{ time: '65.12', lineLyric: '普通歌词' }, {}] } });
    const lyrics = await fetchKuwoLyrics(42);
    expect(lyrics).toBe('[01:05.12]普通歌词\n[00:00.00]');
  });

  it('损坏压缩包、失败代理及主歌词错误均可结束，取消则向上传播', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not compressed')).mockResolvedValueOnce(new Response('bad', { status: 502 }));
    expect(await fetchKuwoLyrics(42)).toBe('');
    fetchMock.mockRejectedValue(new Error('offline'));
    vi.mocked(proxyFetchJson).mockRejectedValue(new Error('unavailable'));
    expect(await fetchKuwoLyrics(42)).toBe('');
    const controller = new AbortController(); controller.abort(new Error('cancel-lyrics'));
    await expect(fetchKuwoLyrics(42, controller.signal)).rejects.toThrow('cancel-lyrics');
  });
});
